package utils

import (
	"context"
	"fmt"
	"path"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/wallcrawler/backend-go/internal/types"
)

const (
	sessionUploadsPrefixFormat    = "sessions/%s/uploads/"
	sessionRecordingsPrefixFormat = "sessions/%s/recordings/"
)

// SessionUploadsPrefix returns the S3 key prefix for uploaded session assets.
func SessionUploadsPrefix(sessionID string) string {
	return fmt.Sprintf(sessionUploadsPrefixFormat, sessionID)
}

// SessionRecordingsPrefix returns the S3 key prefix for session recordings.
func SessionRecordingsPrefix(sessionID string) string {
	return fmt.Sprintf(sessionRecordingsPrefixFormat, sessionID)
}

// BuildSessionUploadKey assembles a full object key for a new session upload.
func BuildSessionUploadKey(sessionID, objectID, fileName string) string {
	base := path.Base(strings.TrimSpace(fileName))
	return fmt.Sprintf("%s%s/%s", SessionUploadsPrefix(sessionID), objectID, base)
}

// ListSessionArtifacts enumerates objects under a session prefix and attaches temporary download URLs.
func ListSessionArtifacts(ctx context.Context, bucket, prefix string, expires time.Duration) ([]types.SessionArtifact, error) {
	client, err := GetS3Client(ctx)
	if err != nil {
		return nil, err
	}

	var (
		continuationToken *string
		artifacts         []types.SessionArtifact
	)

	for {
		output, err := client.ListObjectsV2(ctx, &s3.ListObjectsV2Input{
			Bucket:            aws.String(bucket),
			Prefix:            aws.String(prefix),
			ContinuationToken: continuationToken,
		})
		if err != nil {
			return nil, err
		}

		for _, object := range output.Contents {
			if object.Key == nil {
				continue
			}

			key := *object.Key
			if strings.HasSuffix(key, "/") {
				continue // Skip directory placeholders
			}

			downloadURL, err := GenerateDownloadURL(ctx, bucket, key, expires)
			if err != nil {
				return nil, err
			}

			var (
				lastModified     string
				lastModifiedTime time.Time
			)

			if object.LastModified != nil {
				lastModifiedTime = *object.LastModified
				lastModified = lastModifiedTime.Format(time.RFC3339)
			}

			artifacts = append(artifacts, types.SessionArtifact{
				Key:              key,
				FileName:         path.Base(key),
				Size:             aws.ToInt64(object.Size),
				LastModified:     lastModified,
				DownloadURL:      downloadURL,
				LastModifiedTime: lastModifiedTime,
			})
		}

		if !aws.ToBool(output.IsTruncated) {
			break
		}
		continuationToken = output.NextContinuationToken
	}

	return artifacts, nil
}
