/**
 * S3 Artifact Manager
 * Handles storage and retrieval of browser automation artifacts in S3
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';

import { Artifact, ArtifactList } from '@wallcrawler/stagehand';
import { S3ArtifactMetadata } from '../types';

export interface S3ArtifactManagerConfig {
  region: string;
  bucketName: string;
  keyPrefix?: string;
  enabled?: boolean;
}

/**
 * Manages artifact storage in S3
 */
export class S3ArtifactManager {
  private readonly s3Client: S3Client;
  private readonly config: S3ArtifactManagerConfig;

  constructor(config: S3ArtifactManagerConfig) {
    this.config = config;
    this.s3Client = new S3Client({ region: config.region });
  }

  // =============================================================================
  // Artifact Storage
  // =============================================================================

  async saveArtifact(sessionId: string, filePath: string, data: Buffer): Promise<Artifact> {
    if (!this.config.enabled || !this.config.bucketName) {
      throw new Error('S3 artifact storage is not enabled or configured');
    }

    console.log(`[S3ArtifactManager] Saving artifact for session ${sessionId}: ${filePath}`);

    try {
      const artifactId = this.generateArtifactId();
      const fileName = this.extractFileName(filePath);
      const s3Key = this.generateS3Key(sessionId, artifactId, fileName);
      const mimeType = this.detectMimeType(fileName);

      const metadata: S3ArtifactMetadata = {
        id: artifactId,
        sessionId,
        fileName,
        size: data.length,
        mimeType,
        uploadedAt: new Date(),
        s3Key,
        s3Bucket: this.config.bucketName,
        metadata: {
          originalPath: filePath,
        },
      };

      // Upload to S3
      const command = new PutObjectCommand({
        Bucket: this.config.bucketName,
        Key: s3Key,
        Body: data,
        ContentType: mimeType,
        Metadata: {
          sessionId,
          artifactId,
          fileName,
          originalPath: filePath,
          uploadedAt: metadata.uploadedAt.toISOString(),
        },
        ServerSideEncryption: 'AES256',
      });

      await this.s3Client.send(command);

      // Convert to standard Artifact format
      const artifact: Artifact = {
        id: artifactId,
        name: fileName,
        size: data.length,
        createdAt: metadata.uploadedAt,
        path: `s3://${this.config.bucketName}/${s3Key}`,
        metadata: {
          sessionId,
          originalPath: filePath,
          s3Bucket: this.config.bucketName,
          s3Key,
          mimeType,
        },
      };

      console.log(`[S3ArtifactManager] Saved artifact ${artifactId} to S3: ${s3Key}`);
      return artifact;
    } catch (error) {
      console.error('[S3ArtifactManager] Failed to save artifact:', error);
      throw error;
    }
  }

  async getArtifacts(sessionId: string, cursor?: string): Promise<ArtifactList> {
    if (!this.config.enabled || !this.config.bucketName) {
      return {
        artifacts: [],
        totalCount: 0,
        hasMore: false,
      };
    }

    console.log(`[S3ArtifactManager] Getting artifacts for session: ${sessionId}`);

    try {
      const prefix = this.getSessionPrefix(sessionId);
      const command = new ListObjectsV2Command({
        Bucket: this.config.bucketName,
        Prefix: prefix,
        MaxKeys: 50, // Limit for pagination
        ContinuationToken: cursor,
      });

      const response = await this.s3Client.send(command);

      if (!response.Contents) {
        return {
          artifacts: [],
          totalCount: 0,
          hasMore: false,
        };
      }

      // Convert S3 objects to artifacts
      const artifactPromises = response.Contents.map(async (obj) => {
        if (!obj.Key) return null;

        try {
          // Get object metadata
          const headCommand = new HeadObjectCommand({
            Bucket: this.config.bucketName,
            Key: obj.Key,
          });

          const headResponse = await this.s3Client.send(headCommand);
          const metadata = headResponse.Metadata || {};

          const artifact: Artifact = {
            id: metadata.artifactId || this.extractArtifactIdFromKey(obj.Key),
            name: metadata.fileName || this.extractFileNameFromKey(obj.Key),
            size: obj.Size || 0,
            createdAt: obj.LastModified || new Date(),
            path: `s3://${this.config.bucketName}/${obj.Key}`,
            metadata: {
              sessionId,
              s3Bucket: this.config.bucketName,
              s3Key: obj.Key,
              originalPath: metadata.originalPath,
              mimeType: headResponse.ContentType,
            },
          };

          return artifact;
        } catch (error) {
          console.error(`[S3ArtifactManager] Failed to get metadata for ${obj.Key}:`, error);
          return null;
        }
      });

      const artifacts = (await Promise.all(artifactPromises)).filter(
        (artifact): artifact is Artifact => artifact !== null
      );

      return {
        artifacts,
        totalCount: artifacts.length,
        hasMore: !!response.IsTruncated,
        nextCursor: response.NextContinuationToken,
      };
    } catch (error) {
      console.error('[S3ArtifactManager] Failed to get artifacts:', error);
      return {
        artifacts: [],
        totalCount: 0,
        hasMore: false,
      };
    }
  }

  async downloadArtifact(sessionId: string, artifactId: string): Promise<Buffer> {
    if (!this.config.enabled || !this.config.bucketName) {
      throw new Error('S3 artifact storage is not enabled or configured');
    }

    console.log(`[S3ArtifactManager] Downloading artifact ${artifactId} for session ${sessionId}`);

    try {
      // First, find the S3 key for this artifact
      const artifacts = await this.getArtifacts(sessionId);
      const artifact = artifacts.artifacts.find((a) => a.id === artifactId);

      if (!artifact || !artifact.metadata?.s3Key) {
        throw new Error(`Artifact ${artifactId} not found for session ${sessionId}`);
      }

      const command = new GetObjectCommand({
        Bucket: this.config.bucketName,
        Key: artifact.metadata.s3Key as string,
      });

      const response = await this.s3Client.send(command);

      if (!response.Body) {
        throw new Error(`Failed to download artifact ${artifactId}: No body in response`);
      }

      // Convert stream to buffer
      const chunks: Uint8Array[] = [];
      const reader = response.Body.transformToWebStream().getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      const buffer = Buffer.concat(chunks);
      console.log(`[S3ArtifactManager] Downloaded artifact ${artifactId} (${buffer.length} bytes)`);

      return buffer;
    } catch (error) {
      console.error('[S3ArtifactManager] Failed to download artifact:', error);
      throw error;
    }
  }

  async deleteArtifact(sessionId: string, artifactId: string): Promise<void> {
    if (!this.config.enabled || !this.config.bucketName) {
      throw new Error('S3 artifact storage is not enabled or configured');
    }

    console.log(`[S3ArtifactManager] Deleting artifact ${artifactId} for session ${sessionId}`);

    try {
      // Find the S3 key for this artifact
      const artifacts = await this.getArtifacts(sessionId);
      const artifact = artifacts.artifacts.find((a) => a.id === artifactId);

      if (!artifact || !artifact.metadata?.s3Key) {
        throw new Error(`Artifact ${artifactId} not found for session ${sessionId}`);
      }

      const command = new DeleteObjectCommand({
        Bucket: this.config.bucketName,
        Key: artifact.metadata.s3Key as string,
      });

      await this.s3Client.send(command);
      console.log(`[S3ArtifactManager] Deleted artifact ${artifactId}`);
    } catch (error) {
      console.error('[S3ArtifactManager] Failed to delete artifact:', error);
      throw error;
    }
  }

  async deleteAllArtifacts(sessionId: string): Promise<void> {
    if (!this.config.enabled || !this.config.bucketName) {
      return;
    }

    console.log(`[S3ArtifactManager] Deleting all artifacts for session: ${sessionId}`);

    try {
      const artifacts = await this.getArtifacts(sessionId);

      const deletePromises = artifacts.artifacts.map(async (artifact) => {
        if (artifact.metadata?.s3Key) {
          const command = new DeleteObjectCommand({
            Bucket: this.config.bucketName,
            Key: artifact.metadata.s3Key as string,
          });

          await this.s3Client.send(command);
        }
      });

      await Promise.all(deletePromises);
      console.log(`[S3ArtifactManager] Deleted ${artifacts.artifacts.length} artifacts for session ${sessionId}`);
    } catch (error) {
      console.error('[S3ArtifactManager] Failed to delete all artifacts:', error);
      throw error;
    }
  }

  // =============================================================================
  // Utility Methods
  // =============================================================================

  private generateArtifactId(): string {
    return `artifact_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateS3Key(sessionId: string, artifactId: string, fileName: string): string {
    const prefix = this.config.keyPrefix || 'artifacts/';
    const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    return `${prefix}${timestamp}/${sessionId}/${artifactId}_${fileName}`;
  }

  private getSessionPrefix(sessionId: string): string {
    const prefix = this.config.keyPrefix || 'artifacts/';
    return `${prefix}${sessionId}/`;
  }

  private extractFileName(filePath: string): string {
    return filePath.split('/').pop() || 'unknown';
  }

  private extractArtifactIdFromKey(s3Key: string): string {
    const parts = s3Key.split('/');
    const fileName = parts[parts.length - 1];
    const artifactId = fileName.split('_')[0];
    return artifactId || 'unknown';
  }

  private extractFileNameFromKey(s3Key: string): string {
    const parts = s3Key.split('/');
    const fileName = parts[parts.length - 1];
    // Remove artifact ID prefix
    const underscoreIndex = fileName.indexOf('_');
    return underscoreIndex >= 0 ? fileName.substring(underscoreIndex + 1) : fileName;
  }

  private detectMimeType(fileName: string): string {
    const extension = fileName.split('.').pop()?.toLowerCase();

    const mimeTypes: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      pdf: 'application/pdf',
      txt: 'text/plain',
      csv: 'text/csv',
      json: 'application/json',
      html: 'text/html',
      xml: 'application/xml',
      zip: 'application/zip',
      mp4: 'video/mp4',
      webm: 'video/webm',
    };

    return mimeTypes[extension || ''] || 'application/octet-stream';
  }

  // =============================================================================
  // Configuration and Management
  // =============================================================================

  isEnabled(): boolean {
    return this.config.enabled && !!this.config.bucketName;
  }

  getConfig(): S3ArtifactManagerConfig {
    return { ...this.config };
  }

  async testConnection(): Promise<boolean> {
    if (!this.config.enabled || !this.config.bucketName) {
      return false;
    }

    try {
      // Test with a simple list operation
      const command = new ListObjectsV2Command({
        Bucket: this.config.bucketName,
        MaxKeys: 1,
      });

      await this.s3Client.send(command);
      return true;
    } catch (error) {
      console.error('[S3ArtifactManager] Connection test failed:', error);
      return false;
    }
  }

  async getStorageStats(sessionId?: string): Promise<{
    totalObjects: number;
    totalSize: number;
    bucketName: string;
    isEnabled: boolean;
  }> {
    if (!this.config.enabled || !this.config.bucketName) {
      return {
        totalObjects: 0,
        totalSize: 0,
        bucketName: '',
        isEnabled: false,
      };
    }

    try {
      const prefix = sessionId ? this.getSessionPrefix(sessionId) : this.config.keyPrefix || '';

      const command = new ListObjectsV2Command({
        Bucket: this.config.bucketName,
        Prefix: prefix,
      });

      const response = await this.s3Client.send(command);

      let totalObjects = 0;
      let totalSize = 0;

      if (response.Contents) {
        totalObjects = response.Contents.length;
        totalSize = response.Contents.reduce((sum, obj) => sum + (obj.Size || 0), 0);
      }

      return {
        totalObjects,
        totalSize,
        bucketName: this.config.bucketName,
        isEnabled: true,
      };
    } catch (error) {
      console.error('[S3ArtifactManager] Failed to get storage stats:', error);
      return {
        totalObjects: 0,
        totalSize: 0,
        bucketName: this.config.bucketName,
        isEnabled: false,
      };
    }
  }
}
