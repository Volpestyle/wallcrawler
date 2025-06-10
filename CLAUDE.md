# Claude Development Guidelines for WallCrawler

## Package Management

- **Always use the latest versions**: For any package installation, either:
  1. Check Context7 for the most up-to-date version
  2. Install directly via command line to get the latest version
  3. Use `npm install package@latest` or `pnpm add package@latest`

## Technical Implementation References

- **Primary Reference**: Use the Stagehand GitHub repository (https://github.com/browserbase/stagehand) as the main reference for implementation patterns
- **Context7**: Consult Context7 for architectural decisions and best practices
- **Implementation Alignment**: Ensure our implementation aligns with Stagehand's patterns for:
  - DOM processing and chunking strategies
  - Selector generation approaches
  - Error handling patterns
  - LLM integration methods
  - Browser automation best practices

## Development Workflow

1. Check Stagehand repo for similar functionality before implementing
2. Use Context7 for architectural guidance
3. Install packages with latest versions
4. Follow TypeScript strict mode patterns
5. Implement comprehensive error handling