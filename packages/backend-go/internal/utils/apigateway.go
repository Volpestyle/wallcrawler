package utils

import (
	"fmt"
	"strings"
)

// GetAuthorizerString extracts a string value from the map provided by API Gateway's
// Lambda authorizer.
func GetAuthorizerString(authorizer map[string]interface{}, key string) string {
	if authorizer == nil {
		return ""
	}
	if value, ok := authorizer[key]; ok {
		switch v := value.(type) {
		case string:
			return v
		case fmt.Stringer:
			return v.String()
		case *string:
			if v != nil {
				return *v
			}
		}
	}
	return ""
}

// GetAuthorizedProjectID returns the project identifier injected by the Lambda authorizer.
func GetAuthorizedProjectID(authorizer map[string]interface{}) string {
	return GetAuthorizerString(authorizer, "projectId")
}

// GetAuthorizedProjectIDs returns all project identifiers attached to the request context.
func GetAuthorizedProjectIDs(authorizer map[string]interface{}) []string {
	if authorizer == nil {
		return nil
	}

	raw := authorizer["projectIds"]
	var projects []string

	switch v := raw.(type) {
	case string:
		if v != "" {
			for _, part := range strings.Split(v, ",") {
				project := strings.TrimSpace(part)
				if project != "" {
					projects = append(projects, project)
				}
			}
		}
	case []interface{}:
		for _, item := range v {
			switch id := item.(type) {
			case string:
				project := strings.TrimSpace(id)
				if project != "" {
					projects = append(projects, project)
				}
			}
		}
	case []string:
		for _, id := range v {
			project := strings.TrimSpace(id)
			if project != "" {
				projects = append(projects, project)
			}
		}
	}

	if len(projects) == 0 {
		if id := GetAuthorizedProjectID(authorizer); id != "" {
			projects = append(projects, id)
		}
	}

	// Remove duplicates while preserving order
	seen := make(map[string]struct{}, len(projects))
	unique := make([]string, 0, len(projects))
	for _, id := range projects {
		key := strings.ToLower(id)
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		unique = append(unique, id)
	}

	return unique
}
