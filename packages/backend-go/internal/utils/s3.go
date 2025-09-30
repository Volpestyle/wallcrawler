package utils

import (
	"context"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/s3/manager"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

var (
	s3Client      *s3.Client
	presignClient *s3.PresignClient
)

// GetS3Client returns a shared S3 client instance.
func GetS3Client(ctx context.Context) (*s3.Client, error) {
	if s3Client != nil {
		return s3Client, nil
	}

	cfg, err := config.LoadDefaultConfig(ctx)
	if err != nil {
		return nil, err
	}

	s3Client = s3.NewFromConfig(cfg)
	return s3Client, nil
}

// GetS3PresignClient returns a shared presign client for S3 operations.
func GetS3PresignClient(ctx context.Context) (*s3.PresignClient, error) {
	if presignClient != nil {
		return presignClient, nil
	}

	client, err := GetS3Client(ctx)
	if err != nil {
		return nil, err
	}

	presignClient = s3.NewPresignClient(client)
	return presignClient, nil
}

// GenerateUploadURL creates a pre-signed PUT URL for uploading context archives.
func GenerateUploadURL(ctx context.Context, bucket, key string, expires time.Duration) (string, error) {
	presigner, err := GetS3PresignClient(ctx)
	if err != nil {
		return "", err
	}

	result, err := presigner.PresignPutObject(ctx, &s3.PutObjectInput{
		Bucket: aws.String(bucket),
		Key:    aws.String(key),
	}, s3.WithPresignExpires(expires))
	if err != nil {
		return "", err
	}

	return result.URL, nil
}

// GenerateDownloadURL creates a pre-signed GET URL for downloading context archives.
func GenerateDownloadURL(ctx context.Context, bucket, key string, expires time.Duration) (string, error) {
	presigner, err := GetS3PresignClient(ctx)
	if err != nil {
		return "", err
	}

	result, err := presigner.PresignGetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(bucket),
		Key:    aws.String(key),
	}, s3.WithPresignExpires(expires))
	if err != nil {
		return "", err
	}

	return result.URL, nil
}

// NewUploader returns an S3 uploader bound to the shared client.
func NewUploader(ctx context.Context) (*manager.Uploader, error) {
	client, err := GetS3Client(ctx)
	if err != nil {
		return nil, err
	}
	return manager.NewUploader(client), nil
}
