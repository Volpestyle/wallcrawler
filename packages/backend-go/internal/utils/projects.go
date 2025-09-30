package utils

import (
	"context"
	"fmt"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	dynamotypes "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/wallcrawler/backend-go/internal/types"
)

// GetProjectMetadata retrieves project configuration from DynamoDB.
func GetProjectMetadata(ctx context.Context, ddbClient *dynamodb.Client, projectID string) (*types.Project, error) {
	projectID = strings.TrimSpace(projectID)
	if projectID == "" {
		return nil, fmt.Errorf("missing project id")
	}
	if ProjectsTableName == "" {
		return nil, fmt.Errorf("PROJECTS_TABLE_NAME environment variable not configured")
	}

	result, err := ddbClient.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(ProjectsTableName),
		Key: map[string]dynamotypes.AttributeValue{
			"projectId": &dynamotypes.AttributeValueMemberS{Value: projectID},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to fetch project metadata: %w", err)
	}

	if result.Item == nil {
		return nil, fmt.Errorf("project %s not found", projectID)
	}

	var project types.Project
	if err := attributevalue.UnmarshalMap(result.Item, &project); err != nil {
		return nil, fmt.Errorf("failed to unmarshal project: %w", err)
	}

	if !strings.EqualFold(project.Status, types.ProjectStatusActive) {
		return nil, fmt.Errorf("project %s is not active", projectID)
	}

	return &project, nil
}
