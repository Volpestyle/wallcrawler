# WallCrawler Agent Demo Guide

This Next.js demo showcases the WallCrawler Agent functionality, which enables multi-step web automation using natural language instructions.

## Running the Demo

1. **Install dependencies:**

   ```bash
   cd packages/demos/nextjs-local
   npm install
   ```

2. **Set up environment variables:**
   Create a `.env.local` file with:

   ```env
   OPENAI_API_KEY=your-openai-api-key
   OPENAI_MODEL=gpt-4-1106-preview
   ```

3. **Run the development server:**

   ```bash
   npm run dev
   ```

4. **Open the demo:**
   Navigate to [http://localhost:3000](http://localhost:3000)

## Using the Agent Demo

1. Click on the **"AI Agent"** tab in the demo interface

2. **Try the pre-built scenarios:**
   - **AI Article Search & Extract**: Searches for "Artificial Intelligence" and extracts the first paragraph
   - **Wikipedia Deep Research**: Comprehensive research on AI including history and applications
   - **GitHub Repository Explorer**: Navigates GitHub to find repository information
   - **Contact Form Submission**: Fills and submits forms automatically
   - **Weather Data Collection**: Collects weather data from multiple cities
   - And more!

3. **Or create custom tasks:**
   - Select "Custom Task" from the dropdown
   - Enter a starting URL (e.g., `https://www.google.com`)
   - Describe your task in natural language
   - Click "Run Agent Task"

## Example Custom Tasks

Here are some example tasks you can try:

### Search and Extract

```
Search for "machine learning tutorials", click on the first result, and extract the main topics covered
```

### Multi-Site Comparison

```
Go to three different news websites and collect their top headline for today
```

### Documentation Navigation

```
Navigate to the React documentation, find the Hooks section, and extract information about useState
```

### Form Interaction

```
Find a contact form on the website and fill it with test data: name "Test User", email "test@example.com"
```

## How It Works

1. **Task Planning**: The agent uses AI to break down your instruction into steps
2. **Step Execution**: Each step is executed using:
   - `navigate`: Go to URLs
   - `act`: Interact with page elements
   - `observe`: Find elements on the page
   - `extract`: Get data from the page
3. **Progress Tracking**: Real-time updates show each step's execution
4. **Result Display**: Final extracted data and execution steps are shown

## Agent Options

- **Max Steps**: Limits the number of actions (default: 10)
- **Planning Strategy**:
  - `sequential`: Plans all steps upfront
  - `adaptive`: Adjusts plan based on results
- **Checkpoint**: Saves state between steps (useful for long tasks)

## Troubleshooting

- **Task times out**: Try increasing `maxSteps` or simplifying the task
- **Can't find elements**: Make the instructions more specific
- **Extraction fails**: Ensure the target page has loaded completely

## API Integration

The agent is exposed through the `/api/wallcrawler` endpoint with these parameters:

```typescript
{
  url: string;              // Starting URL
  command: string;          // Task description
  isAgent: true;           // Enable agent mode
  agentOptions: {
    maxSteps?: number;
    planningStrategy?: 'sequential' | 'adaptive';
    checkpoint?: boolean;
  }
}
```

## Next Steps

- Experiment with different task complexities
- Try combining multiple websites in a single task
- Use the agent for real automation workflows
- Integrate the agent API into your own applications
