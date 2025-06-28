# WallCrawler WebAgent

The WallCrawler WebAgent is a powerful feature that enables execution of complex, multi-step web automation tasks. It uses AI to break down high-level instructions into actionable steps and executes them sequentially or adaptively.

## Overview

The WebAgent extends WallCrawler's capabilities by:
- **Task Planning**: Automatically breaks down complex instructions into individual steps
- **Sequential Execution**: Executes steps in order while handling failures gracefully
- **Adaptive Strategy**: Adjusts execution based on results from previous steps
- **State Management**: Tracks execution history and supports checkpointing
- **Error Recovery**: Integrates with WallCrawler's intervention system for handling errors

## Usage

### Basic Example

```typescript
const page = await crawler.createPage();

// Execute a multi-step task
const result = await page.agent(
  'Go to Amazon, search for "laptop", and find the top 3 results with their prices',
  {
    maxSteps: 10,
    planningStrategy: 'sequential'
  }
);

console.log('Task completed:', result.success);
console.log('Steps executed:', result.steps.length);
console.log('Final output:', result.finalOutput);
```

### Agent Options

```typescript
interface AgentOptions {
  maxSteps?: number;              // Maximum steps to execute (default: 10)
  planningStrategy?: 'sequential' | 'adaptive';  // How to plan steps
  allowParallel?: boolean;         // Allow parallel execution (future)
  checkpoint?: boolean;            // Enable checkpointing for recovery
}
```

### Result Structure

```typescript
interface AgentResult {
  success: boolean;                // Whether the task completed successfully
  steps: AgentStep[];             // Array of executed steps
  finalOutput?: any;              // Extracted data (if any)
  error?: string;                 // Error message (if failed)
}

interface AgentStep {
  instruction: string;            // What this step was trying to do
  action: 'act' | 'extract' | 'observe' | 'navigate';  // Action type
  result: any;                    // Step result
  timestamp: number;              // When the step was executed
  duration: number;               // How long the step took (ms)
}
```

## Examples

### Research Task
```typescript
const result = await page.agent(
  'Research artificial intelligence on Wikipedia. Find its history, key concepts, and applications.',
  { maxSteps: 8, planningStrategy: 'sequential' }
);
```

### Form Filling
```typescript
const result = await page.agent(
  'Fill out the contact form with: Name: John Doe, Email: john@example.com, Message: Hello!',
  { maxSteps: 6, planningStrategy: 'adaptive' }
);
```

### Data Collection
```typescript
const result = await page.agent(
  'Collect weather data for New York, Los Angeles, and Chicago from weather.com',
  { maxSteps: 12, checkpoint: true }
);
```

### Complex Navigation
```typescript
const result = await page.agent(
  'Go to GitHub, find the React repository, check its stars and latest release',
  { maxSteps: 10, planningStrategy: 'adaptive' }
);
```

## How It Works

1. **Task Analysis**: The agent analyzes your instruction using the LLM
2. **Step Planning**: Creates a plan with specific actions (navigate, click, extract, etc.)
3. **Sequential Execution**: Executes each step using WallCrawler's core methods
4. **Progress Tracking**: Monitors success/failure of each step
5. **Adaptive Adjustment**: Can modify future steps based on results
6. **Result Compilation**: Returns comprehensive results with all steps and outputs

## Planning Strategies

### Sequential Strategy
- Plans all steps upfront
- Executes in order
- Best for predictable, linear tasks
- Example: Form filling, structured data extraction

### Adaptive Strategy
- Plans initial steps
- Adjusts based on results
- Better for dynamic content
- Example: Search tasks, content discovery

## Integration with Core Features

The WebAgent seamlessly integrates with WallCrawler's core features:

- **Act**: Used for interactions (clicks, typing, etc.)
- **Extract**: Used for data extraction steps
- **Observe**: Used to find elements and understand page state
- **Interventions**: Automatic detection and handling of CAPTCHAs or errors
- **Caching**: Results can be cached for repeated tasks
- **Self-Healing**: Automatic recovery from selector changes

## Best Practices

1. **Be Specific**: Clear instructions lead to better execution
   ```typescript
   // Good
   'Go to amazon.com, search for "wireless mouse", filter by 4+ stars, extract top 3 results'
   
   // Too vague
   'Find some good mice on Amazon'
   ```

2. **Set Appropriate Limits**: Use maxSteps to prevent infinite loops
   ```typescript
   { maxSteps: 15 }  // Reasonable for most tasks
   ```

3. **Choose the Right Strategy**:
   - Sequential: For structured, predictable tasks
   - Adaptive: For dynamic content or search tasks

4. **Enable Checkpointing**: For long-running or critical tasks
   ```typescript
   { checkpoint: true }
   ```

5. **Handle Failures**: Always check the success status
   ```typescript
   const result = await page.agent(task);
   if (!result.success) {
     console.error('Task failed:', result.error);
     // Handle failure...
   }
   ```

## Limitations

- Maximum steps prevent infinite execution
- Complex tasks may require manual intervention
- Performance depends on LLM response time
- Some tasks may be better suited to direct method calls

## Future Enhancements

- Parallel step execution for independent tasks
- Step caching and reuse
- Visual feedback during execution
- Custom step validators
- Integration with more LLM providers