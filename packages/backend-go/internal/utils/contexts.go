package utils

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	dynamotypes "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/google/uuid"
	"github.com/wallcrawler/backend-go/internal/types"
)

type contextRecord struct {
	ID         string `dynamodbav:"contextId"`
	ProjectID  string `dynamodbav:"projectId"`
	StorageKey string `dynamodbav:"storageKey"`
	CreatedAt  string `dynamodbav:"createdAt"`
	UpdatedAt  string `dynamodbav:"updatedAt"`
	Status     string `dynamodbav:"status"`
}

func generateContextID() string {
	return fmt.Sprintf("ctx_%s", strings.ReplaceAll(uuid.NewString()[:12], "-", ""))
}

func contextS3Key(projectID, contextID string) string {
	return fmt.Sprintf("%s/%s/profile.tar.gz", projectID, contextID)
}

func putContextRecord(ctx context.Context, ddbClient *dynamodb.Client, record contextRecord) error {
	if ContextsTableName == "" {
		return fmt.Errorf("CONTEXTS_TABLE_NAME environment variable not configured")
	}

	item := map[string]dynamotypes.AttributeValue{
		"contextId":  &dynamotypes.AttributeValueMemberS{Value: record.ID},
		"projectId":  &dynamotypes.AttributeValueMemberS{Value: record.ProjectID},
		"storageKey": &dynamotypes.AttributeValueMemberS{Value: record.StorageKey},
		"createdAt":  &dynamotypes.AttributeValueMemberS{Value: record.CreatedAt},
		"updatedAt":  &dynamotypes.AttributeValueMemberS{Value: record.UpdatedAt},
		"status":     &dynamotypes.AttributeValueMemberS{Value: record.Status},
	}

	_, err := ddbClient.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(ContextsTableName),
		Item:      item,
	})
	return err
}

func getContextRecord(ctx context.Context, ddbClient *dynamodb.Client, contextID string) (*contextRecord, error) {
	if ContextsTableName == "" {
		return nil, fmt.Errorf("CONTEXTS_TABLE_NAME environment variable not configured")
	}

	result, err := ddbClient.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(ContextsTableName),
		Key: map[string]dynamotypes.AttributeValue{
			"contextId": &dynamotypes.AttributeValueMemberS{Value: contextID},
		},
	})
	if err != nil {
		return nil, err
	}

	if result.Item == nil {
		return nil, fmt.Errorf("context %s not found", contextID)
	}

	record := &contextRecord{}
	if err := attributevalue.UnmarshalMap(result.Item, record); err != nil {
		return nil, err
	}

	return record, nil
}

func ContextRecordToAPI(record *contextRecord) *types.Context {
	if record == nil {
		return nil
	}

	return &types.Context{
		ID:        record.ID,
		ProjectID: record.ProjectID,
		CreatedAt: record.CreatedAt,
		UpdatedAt: record.UpdatedAt,
	}
}

func CreateContext(ctx context.Context, ddbClient *dynamodb.Client, projectID string) (*contextRecord, error) {
	contextID := generateContextID()
	now := time.Now().UTC().Format(time.RFC3339)
	record := contextRecord{
		ID:         contextID,
		ProjectID:  projectID,
		StorageKey: contextS3Key(projectID, contextID),
		CreatedAt:  now,
		UpdatedAt:  now,
		Status:     "CREATED",
	}

	if err := putContextRecord(ctx, ddbClient, record); err != nil {
		return nil, err
	}

	return &record, nil
}

func UpdateContextTimestamp(ctx context.Context, ddbClient *dynamodb.Client, record *contextRecord) error {
	record.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	return putContextRecord(ctx, ddbClient, *record)
}

func GetContextForProject(ctx context.Context, ddbClient *dynamodb.Client, projectID, contextID string) (*contextRecord, error) {
	record, err := getContextRecord(ctx, ddbClient, contextID)
	if err != nil {
		return nil, err
	}

	if !strings.EqualFold(record.ProjectID, projectID) {
		return nil, fmt.Errorf("context does not belong to project")
	}

	return record, nil
}

func ContextStorageKey(record *contextRecord) string {
	if record == nil {
		return ""
	}
	return record.StorageKey
}
