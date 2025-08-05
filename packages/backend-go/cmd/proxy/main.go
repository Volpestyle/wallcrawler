package main

import (
	"bytes"
	"io"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/wallcrawler/backend-go/internal/proxy"
)

var (
	internalAPIURL string
	awsAPIKey      string
	isLambda       bool
)

func init() {
	internalAPIURL = os.Getenv("INTERNAL_API_URL")
	if internalAPIURL == "" {
		log.Fatal("INTERNAL_API_URL environment variable is required")
	}

	awsAPIKey = os.Getenv("AWS_API_KEY")
	if awsAPIKey == "" {
		log.Fatal("AWS_API_KEY environment variable is required")
	}

	// Detect if running in Lambda
	if os.Getenv("AWS_LAMBDA_FUNCTION_NAME") != "" {
		isLambda = true
	}
}

// ProxyHandler handles all incoming requests and forwards them to the internal API
func ProxyHandler(w http.ResponseWriter, r *http.Request) {
	// Check for Wallcrawler API key
	wcAPIKey := r.Header.Get("x-wc-api-key")
	if wcAPIKey == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte(`{"error": "Missing required header: x-wc-api-key"}`))
		return
	}

	// Validate the Wallcrawler API key
	if !proxy.ValidateWallcrawlerAPIKey(wcAPIKey) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte(`{"error": "Invalid Wallcrawler API key"}`))
		return
	}

	// Parse the internal API URL
	targetURL, err := url.Parse(internalAPIURL)
	if err != nil {
		log.Printf("Error parsing internal API URL: %v", err)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(`{"error": "Internal server error"}`))
		return
	}

	// Create a new request to forward
	targetURL.Path = r.URL.Path
	targetURL.RawQuery = r.URL.RawQuery

	// Read the request body
	bodyBytes, err := io.ReadAll(r.Body)
	if err != nil {
		log.Printf("Error reading request body: %v", err)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(`{"error": "Internal server error"}`))
		return
	}
	r.Body.Close()

	// Create the proxy request
	proxyReq, err := http.NewRequest(r.Method, targetURL.String(), bytes.NewReader(bodyBytes))
	if err != nil {
		log.Printf("Error creating proxy request: %v", err)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(`{"error": "Internal server error"}`))
		return
	}

	// Copy headers from original request
	for name, values := range r.Header {
		// Skip hop-by-hop headers
		if isHopByHopHeader(name) {
			continue
		}
		for _, value := range values {
			proxyReq.Header.Add(name, value)
		}
	}

	// Add the AWS API key
	proxyReq.Header.Set("X-API-Key", awsAPIKey)

	// Log the proxy request for debugging
	log.Printf("Proxying %s %s", r.Method, targetURL.String())

	// Make the request
	client := &http.Client{
		Timeout: 30 * time.Second,
	}
	resp, err := client.Do(proxyReq)
	if err != nil {
		log.Printf("Error making proxy request: %v", err)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadGateway)
		w.Write([]byte(`{"error": "Failed to reach internal API"}`))
		return
	}
	defer resp.Body.Close()

	// Copy response headers
	for name, values := range resp.Header {
		if isHopByHopHeader(name) {
			continue
		}
		for _, value := range values {
			w.Header().Add(name, value)
		}
	}

	// Copy status code
	w.WriteHeader(resp.StatusCode)

	// Copy response body
	io.Copy(w, resp.Body)
}

// isHopByHopHeader checks if a header is hop-by-hop
func isHopByHopHeader(name string) bool {
	hopByHopHeaders := []string{
		"Connection",
		"Keep-Alive",
		"Proxy-Authenticate",
		"Proxy-Authorization",
		"TE",
		"Trailers",
		"Transfer-Encoding",
		"Upgrade",
	}

	name = strings.ToLower(name)
	for _, h := range hopByHopHeaders {
		if strings.ToLower(h) == name {
			return true
		}
	}
	return false
}

// LambdaHandler adapts the HTTP handler for AWS Lambda
func LambdaHandler(request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	// Convert Lambda request to http.Request
	body := strings.NewReader(request.Body)
	httpReq, err := http.NewRequest(
		request.HTTPMethod,
		request.Path,
		body,
	)
	if err != nil {
		return events.APIGatewayProxyResponse{
			StatusCode: 500,
			Body:       `{"error": "Internal server error"}`,
			Headers: map[string]string{
				"Content-Type": "application/json",
			},
		}, nil
	}

	// Add headers
	for name, value := range request.Headers {
		httpReq.Header.Set(name, value)
	}

	// Add query parameters
	q := httpReq.URL.Query()
	for name, value := range request.QueryStringParameters {
		q.Set(name, value)
	}
	httpReq.URL.RawQuery = q.Encode()

	// Create a response writer
	recorder := httptest.NewRecorder()

	// Call the handler
	ProxyHandler(recorder, httpReq)

	// Convert response
	responseBody := recorder.Body.String()
	responseHeaders := make(map[string]string)
	for name, values := range recorder.Header() {
		if len(values) > 0 {
			responseHeaders[name] = values[0]
		}
	}

	return events.APIGatewayProxyResponse{
		StatusCode: recorder.Code,
		Body:       responseBody,
		Headers:    responseHeaders,
	}, nil
}

// For Lambda, we need httptest
type responseWriter struct {
	headers http.Header
	body    *bytes.Buffer
	status  int
}

func (w *responseWriter) Header() http.Header {
	return w.headers
}

func (w *responseWriter) Write(b []byte) (int, error) {
	return w.body.Write(b)
}

func (w *responseWriter) WriteHeader(status int) {
	w.status = status
}

// Simple httptest.ResponseRecorder implementation
type ResponseRecorder struct {
	Code      int
	HeaderMap http.Header
	Body      *bytes.Buffer
}

func NewRecorder() *ResponseRecorder {
	return &ResponseRecorder{
		HeaderMap: make(http.Header),
		Body:      new(bytes.Buffer),
		Code:      200,
	}
}

func (rw *ResponseRecorder) Header() http.Header {
	return rw.HeaderMap
}

func (rw *ResponseRecorder) Write(buf []byte) (int, error) {
	return rw.Body.Write(buf)
}

func (rw *ResponseRecorder) WriteHeader(code int) {
	rw.Code = code
}

var httptest = struct {
	NewRecorder func() *ResponseRecorder
}{
	NewRecorder: NewRecorder,
}

func main() {
	if isLambda {
		// Running in Lambda
		lambda.Start(LambdaHandler)
	} else {
		// Running as HTTP server
		port := os.Getenv("PORT")
		if port == "" {
			port = "8080"
		}

		// Create a simple reverse proxy for debugging
		target, _ := url.Parse(internalAPIURL)
		proxy := httputil.NewSingleHostReverseProxy(target)

		// Modify the director to add AWS API key
		originalDirector := proxy.Director
		proxy.Director = func(req *http.Request) {
			originalDirector(req)
			req.Header.Set("X-API-Key", awsAPIKey)
			req.Host = target.Host
		}

		// Use our custom handler instead of the simple proxy
		http.HandleFunc("/", ProxyHandler)

		log.Printf("Starting proxy server on port %s", port)
		log.Printf("Proxying requests to: %s", internalAPIURL)
		log.Fatal(http.ListenAndServe(":"+port, nil))
	}
}