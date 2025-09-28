package utils

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	dynamotypes "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/wallcrawler/backend-go/internal/types"
)

// hashAPIKey returns a stable SHA-256 hash for storing API keys in DynamoDB.
func hashAPIKey(apiKey string) string {
	sum := sha256.Sum256([]byte(apiKey))
	return hex.EncodeToString(sum[:])
}

// ValidateWallcrawlerAPIKey validates the provided API key against DynamoDB and
// returns the resolved metadata if the key is active.
func ValidateWallcrawlerAPIKey(ctx context.Context, ddbClient *dynamodb.Client, apiKey string) (*types.APIKeyMetadata, error) {
	apiKey = strings.TrimSpace(apiKey)
	if apiKey == "" {
		return nil, fmt.Errorf("missing API key")
	}

	if !strings.HasPrefix(apiKey, "wc_") {
		return nil, fmt.Errorf("invalid API key format")
	}

	if APIKeysTableName == "" {
		return nil, fmt.Errorf("API_KEYS_TABLE_NAME environment variable not configured")
	}

	keyHash := hashAPIKey(apiKey)

	result, err := ddbClient.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(APIKeysTableName),
		Key: map[string]dynamotypes.AttributeValue{
			"apiKeyHash": &dynamotypes.AttributeValueMemberS{Value: keyHash},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to lookup API key: %w", err)
	}

	if result.Item == nil {
		return nil, fmt.Errorf("api key not found")
	}

	var metadata types.APIKeyMetadata
	if err := attributevalue.UnmarshalMap(result.Item, &metadata); err != nil {
		return nil, fmt.Errorf("failed to unmarshal API key metadata: %w", err)
	}

	metadata.APIKeyHash = keyHash

	if !strings.EqualFold(metadata.Status, types.APIKeyStatusActive) {
		return nil, fmt.Errorf("api key is not active")
	}

	allowedProjects := make([]string, 0, len(metadata.ProjectIDs)+1)
	seen := make(map[string]struct{})
	for _, id := range metadata.ProjectIDs {
		project := strings.TrimSpace(id)
		if project == "" {
			continue
		}
		if _, exists := seen[strings.ToLower(project)]; exists {
			continue
		}
		seen[strings.ToLower(project)] = struct{}{}
		allowedProjects = append(allowedProjects, project)
	}

	if metadata.ProjectID != "" {
		primary := strings.TrimSpace(metadata.ProjectID)
		if primary != "" {
			if _, exists := seen[strings.ToLower(primary)]; !exists {
				allowedProjects = append([]string{primary}, allowedProjects...)
				seen[strings.ToLower(primary)] = struct{}{}
			}
		}
	}

	if len(allowedProjects) == 0 {
		return nil, fmt.Errorf("api key missing project assignment")
	}

	metadata.ProjectIDs = allowedProjects
	metadata.ProjectID = allowedProjects[0]

	log.Printf("API key validation passed for projects: %v", allowedProjects)
	return &metadata, nil
}
