import { z } from 'zod';

export interface AgentDemoScenario {
  id: string;
  name: string;
  description: string;
  category: 'research' | 'form-filling' | 'data-collection' | 'navigation';
  task: string;
  agentOptions?: {
    maxSteps?: number;
    planningStrategy?: 'sequential' | 'adaptive';
    checkpoint?: boolean;
  };
  exampleResults?: any;
}

export const agentDemoScenarios: AgentDemoScenario[] = [
  {
    id: 'ai-search-extract',
    name: 'AI Article Search & Extract',
    description: 'Search for "Artificial Intelligence", navigate to the page, and extract the first paragraph',
    category: 'research',
    task: 'Search for "Artificial Intelligence", navigate to the page, and extract the first paragraph of the article',
    agentOptions: {
      maxSteps: 5,
      planningStrategy: 'sequential',
    },
    exampleResults: {
      firstParagraph: 'Artificial intelligence (AI) is intelligence demonstrated by machines, in contrast to the natural intelligence displayed by humans and animals...',
      source: 'Wikipedia',
    },
  },
  {
    id: 'wikipedia-research',
    name: 'Wikipedia Deep Research',
    description: 'Research a topic across multiple Wikipedia pages',
    category: 'research',
    task: 'Go to Wikipedia and research "artificial intelligence". Find information about its history, key concepts, and current applications. Extract a summary of the most important points.',
    agentOptions: {
      maxSteps: 8,
      planningStrategy: 'sequential',
    },
    exampleResults: {
      history: 'AI research began in the 1950s...',
      concepts: ['Machine Learning', 'Neural Networks', 'Deep Learning'],
      applications: ['Computer Vision', 'Natural Language Processing', 'Robotics'],
    },
  },
  {
    id: 'github-repo-explore',
    name: 'GitHub Repository Explorer',
    description: 'Navigate GitHub to find information about a popular repository',
    category: 'navigation',
    task: 'Go to GitHub and find the React repository. Navigate to the README, check the number of stars, find the latest release version, and identify the main contributors.',
    agentOptions: {
      maxSteps: 10,
      planningStrategy: 'adaptive',
    },
    exampleResults: {
      repository: 'facebook/react',
      stars: '200k+',
      latestRelease: 'v18.2.0',
      topContributors: ['gaearon', 'sophiebits', 'acdlite'],
    },
  },
  {
    id: 'contact-form-submit',
    name: 'Contact Form Submission',
    description: 'Fill out and submit a contact form with multiple fields',
    category: 'form-filling',
    task: 'Navigate to https://www.w3schools.com/html/tryit.asp?filename=tryhtml_form_submit and fill out the form with: First name: John, Last name: Doe. Then submit the form.',
    agentOptions: {
      maxSteps: 6,
      planningStrategy: 'sequential',
    },
    exampleResults: {
      formSubmitted: true,
      fields: {
        firstName: 'John',
        lastName: 'Doe',
      },
    },
  },
  {
    id: 'weather-data-collection',
    name: 'Weather Data Collection',
    description: 'Collect weather information for multiple cities',
    category: 'data-collection',
    task: 'Go to weather.com and collect the current temperature and weather conditions for New York, Los Angeles, and Chicago. Create a comparison of the three cities.',
    agentOptions: {
      maxSteps: 12,
      planningStrategy: 'adaptive',
      checkpoint: true,
    },
    exampleResults: {
      cities: {
        'New York': { temp: '72°F', condition: 'Partly Cloudy' },
        'Los Angeles': { temp: '78°F', condition: 'Sunny' },
        'Chicago': { temp: '68°F', condition: 'Overcast' },
      },
    },
  },
  {
    id: 'news-aggregation',
    name: 'News Headlines Aggregation',
    description: 'Collect top headlines from a news website',
    category: 'data-collection',
    task: 'Go to CNN.com and find the top 5 headlines from the homepage. For each headline, extract the title and a brief summary if available.',
    agentOptions: {
      maxSteps: 8,
      planningStrategy: 'sequential',
    },
    exampleResults: {
      headlines: [
        {
          title: 'Breaking News: Major Event Occurs',
          summary: 'Details about the major event...',
        },
        // ... more headlines
      ],
    },
  },
  {
    id: 'recipe-search',
    name: 'Recipe Search and Extraction',
    description: 'Search for a recipe and extract ingredients and instructions',
    category: 'research',
    task: 'Search for "chocolate chip cookies recipe" on Google, click on the first recipe result, and extract the list of ingredients and basic cooking instructions.',
    agentOptions: {
      maxSteps: 10,
      planningStrategy: 'adaptive',
    },
    exampleResults: {
      recipeName: 'Classic Chocolate Chip Cookies',
      ingredients: ['2 cups flour', '1 cup butter', '1 cup chocolate chips'],
      instructions: ['Preheat oven to 375°F', 'Mix ingredients', 'Bake for 10-12 minutes'],
    },
  },
  {
    id: 'shopping-comparison',
    name: 'Price Comparison Shopping',
    description: 'Compare prices for a product across different sections of a site',
    category: 'data-collection',
    task: 'Go to Amazon.com and search for "wireless mouse". Find the top 3 results and extract their names, prices, and ratings. Identify which one has the best value.',
    agentOptions: {
      maxSteps: 10,
      planningStrategy: 'sequential',
    },
    exampleResults: {
      products: [
        { name: 'Logitech Wireless Mouse', price: '$24.99', rating: '4.5 stars' },
        { name: 'Amazon Basics Mouse', price: '$12.99', rating: '4.2 stars' },
        { name: 'Razer Gaming Mouse', price: '$49.99', rating: '4.7 stars' },
      ],
      bestValue: 'Amazon Basics Mouse',
    },
  },
  {
    id: 'documentation-navigation',
    name: 'Documentation Navigation',
    description: 'Navigate technical documentation to find specific information',
    category: 'navigation',
    task: 'Go to the MDN Web Docs and find information about the JavaScript Array.map() method. Extract the syntax, parameters description, and find one example of its usage.',
    agentOptions: {
      maxSteps: 8,
      planningStrategy: 'adaptive',
    },
    exampleResults: {
      method: 'Array.prototype.map()',
      syntax: 'array.map(callback(element[, index[, array]])[, thisArg])',
      parameters: {
        callback: 'Function that produces an element of the new Array',
        thisArg: 'Value to use as this when executing callback',
      },
      example: 'const doubled = numbers.map(x => x * 2);',
    },
  },
];