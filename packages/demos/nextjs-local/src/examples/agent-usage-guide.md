# WallCrawler Agent Usage Guide

The WallCrawler Agent enables multi-step web automation tasks using natural language instructions. It can decompose complex tasks into individual steps and execute them using the `act`, `extract`, and `observe` handlers.

## Basic Usage

```typescript
const result = await page.agent(
  'Your multi-step instruction here',
  {
    maxSteps: 10,              // Maximum number of steps to execute
    planningStrategy: 'sequential', // or 'adaptive'
    checkpoint: false,         // Enable session checkpointing
  }
);
```

## Example: AI Article Search and Extraction

```typescript
// Simple Wikipedia search
const result = await page.agent(
  'Search for "Artificial Intelligence", navigate to the page, and extract the first paragraph of the article'
);

// The agent will:
// 1. Navigate to a search engine or Wikipedia
// 2. Search for "Artificial Intelligence"
// 3. Click on the appropriate result
// 4. Extract the first paragraph from the article
```

## Agent Options

### Planning Strategies

1. **Sequential**: Plans all steps upfront
   - Best for predictable, linear tasks
   - Faster execution when the path is clear

2. **Adaptive**: Adjusts plan based on results
   - Better for dynamic websites
   - Handles unexpected page layouts

### Example Scenarios

```typescript
// Research task with sequential planning
await page.agent(
  'Go to Wikipedia and research machine learning. Find its definition, main types, and applications.',
  { planningStrategy: 'sequential', maxSteps: 8 }
);

// Form filling with adaptive planning
await page.agent(
  'Find a contact form on the website and fill it with test data: name "John Doe", email "john@example.com"',
  { planningStrategy: 'adaptive', maxSteps: 6 }
);

// Data collection with checkpointing
await page.agent(
  'Visit three news websites and collect today\'s top headlines from each',
  { planningStrategy: 'adaptive', checkpoint: true, maxSteps: 15 }
);
```

## Understanding Agent Results

```typescript
const result = await page.agent(task, options);

// Result structure:
{
  success: boolean;           // Overall task success
  steps: AgentStep[];        // Detailed step execution info
  finalOutput?: any;         // Extracted data (if any)
  error?: string;            // Error message (if failed)
}

// Each step contains:
{
  instruction: string;       // What the agent tried to do
  action: 'act' | 'extract' | 'observe' | 'navigate';
  result: any;              // Step execution result
  timestamp: number;        // When the step was executed
  duration: number;         // How long the step took (ms)
}
```

## Best Practices

1. **Be Specific**: Clear instructions lead to better results
   ```typescript
   // Good
   'Go to example.com, click the "Products" menu, find "Laptops", and extract prices for the first 5 items'
   
   // Too vague
   'Find some product prices'
   ```

2. **Set Appropriate Limits**: Use `maxSteps` to prevent runaway execution
   ```typescript
   // Simple task
   { maxSteps: 5 }
   
   // Complex research task
   { maxSteps: 15 }
   ```

3. **Choose the Right Strategy**:
   - Use `sequential` for well-defined paths
   - Use `adaptive` for exploratory tasks or unpredictable sites

4. **Enable Checkpointing** for long-running tasks:
   ```typescript
   { checkpoint: true }
   ```

## Common Use Cases

### 1. Information Extraction
```typescript
await page.agent(
  'Search for "Python programming" on Google, visit the official Python website, and extract the current version number'
);
```

### 2. Multi-Site Comparison
```typescript
await page.agent(
  'Compare prices for "iPhone 15" on Amazon, Best Buy, and Apple.com. Extract the price from each site.'
);
```

### 3. Documentation Navigation
```typescript
await page.agent(
  'Go to React documentation, find the Hooks section, and extract the list of built-in hooks with their descriptions'
);
```

### 4. Form Automation
```typescript
await page.agent(
  'Find the newsletter signup form, enter email "test@example.com", check the "weekly updates" checkbox, and submit'
);
```

## Error Handling

The agent includes built-in error recovery and intervention detection:

```typescript
try {
  const result = await page.agent(task);
  
  if (!result.success) {
    console.log('Task failed:', result.error);
    // Check individual steps to see where it failed
    const failedStep = result.steps.find(s => s.result.error);
  }
} catch (error) {
  // Handle critical errors (network issues, page crashes, etc.)
}
```

## Advanced Features

### Combining with Other WallCrawler Methods

```typescript
// Use agent for navigation, then specialized methods
await page.agent('Navigate to the login page');
await page.act('Fill username field with "user123"');
await page.act('Fill password field with "pass123"');
await page.act('Click the login button');

// Extract structured data after agent navigation
await page.agent('Go to product catalog and filter by "Electronics"');
const products = await page.extract({
  instruction: 'Extract all product names and prices',
  schema: z.array(z.object({
    name: z.string(),
    price: z.string(),
  }))
});
```

### Debugging Agent Execution

```typescript
const result = await page.agent(task, { maxSteps: 10 });

// Log each step for debugging
result.steps.forEach((step, i) => {
  console.log(`Step ${i + 1}: ${step.action} - ${step.instruction}`);
  if (step.result.error) {
    console.error(`  Failed: ${step.result.error}`);
  }
});
```