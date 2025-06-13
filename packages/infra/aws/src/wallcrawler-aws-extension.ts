import { WallCrawler, WallCrawlerConfig, InfrastructureProvider } from 'wallcrawler';
import { AWSInfrastructureProvider, AWSProviderConfig } from './providers/aws-infrastructure-provider';

/**
 * AWS-specific WallCrawler provider that extends the base functionality
 * with AWS-specific features and optimizations
 */
export class WallCrawlerAWSProvider {
  private provider: AWSInfrastructureProvider;

  constructor(awsConfig: AWSProviderConfig) {
    this.provider = new AWSInfrastructureProvider(awsConfig);
  }

  /**
   * Create a WallCrawler instance with AWS infrastructure
   */
  async createWallCrawler(config: WallCrawlerConfig): Promise<WallCrawler> {
    return new WallCrawler(this.provider, config);
  }

  /**
   * Get the underlying AWS infrastructure provider
   */
  getProvider(): InfrastructureProvider {
    return this.provider;
  }

  /**
   * Get AWS-specific provider instance
   */
  getAWSProvider(): AWSInfrastructureProvider {
    return this.provider;
  }
}