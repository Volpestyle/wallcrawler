import { MousePointer, Play, Eye, Database, FileText } from 'lucide-react';
import { StepType, WorkflowPreset } from './types';

export const stepTypes: StepType[] = [
  {
    value: 'navigate',
    label: 'Navigate',
    icon: <MousePointer className="w-4 h-4" />,
    description: 'Go to a URL',
    cost: 'Free',
  },
  {
    value: 'act',
    label: 'Act',
    icon: <Play className="w-4 h-4" />,
    description: 'Perform an action (DOM-based)',
    cost: 'Low',
  },
  {
    value: 'observe',
    label: 'Observe',
    icon: <Eye className="w-4 h-4" />,
    description: 'Find elements (DOM-based)',
    cost: 'Low',
  },
  {
    value: 'extract',
    label: 'Extract',
    icon: <Database className="w-4 h-4" />,
    description: 'Extract data (DOM-based)',
    cost: 'Low',
  },
  {
    value: 'agent',
    label: 'Agent',
    icon: <FileText className="w-4 h-4" />,
    description: 'AI-driven multi-step (Screenshot-based)',
    cost: 'High',
  },
];

export const presets: WorkflowPreset[] = [
  {
    name: 'Simple Search',
    description: 'Navigate to Google and perform a search',
    steps: [
      {
        type: 'navigate',
        title: 'Go to Google',
        config: { url: 'https://google.com' },
      },
      {
        type: 'act',
        title: 'Search for something',
        config: {
          instruction: 'Search for "web scraping tools" and press Enter',
        },
      },
      {
        type: 'extract',
        title: 'Extract search results',
        config: {
          instruction: 'Extract the first 5 search results',
          schema: '{"results": [{"title": "string", "url": "string", "description": "string"}]}',
        },
      },
    ],
  },
  {
    name: 'E-commerce Flow',
    description: 'Search for a product and add to cart',
    steps: [
      {
        type: 'navigate',
        title: 'Go to Amazon',
        config: { url: 'https://amazon.com' },
      },
      {
        type: 'act',
        title: 'Search for product',
        config: { instruction: 'Search for "wireless headphones"' },
      },
      {
        type: 'observe',
        title: 'Find product listings',
        config: { instruction: 'Find all product cards on the page' },
      },
      {
        type: 'act',
        title: 'Click first product',
        config: {
          instruction: 'Click on the first product in the search results',
        },
      },
      {
        type: 'extract',
        title: 'Extract product details',
        config: {
          instruction: 'Extract product information',
          schema: '{"name": "string", "price": "string", "rating": "string", "availability": "string"}',
        },
      },
    ],
  },
  {
    name: 'Form Automation',
    description: 'Fill out a contact form',
    steps: [
      {
        type: 'navigate',
        title: 'Go to demo form',
        config: { url: 'https://httpbin.org/forms/post' },
      },
      {
        type: 'observe',
        title: 'Find form fields',
        config: { instruction: 'Find all form input fields' },
      },
      {
        type: 'act',
        title: 'Fill out form',
        config: {
          instruction: 'Fill out the form with: name "John Doe", email "john@example.com", comments "This is a test"',
        },
      },
      {
        type: 'act',
        title: 'Submit form',
        config: { instruction: 'Click the submit button' },
      },
    ],
  },
];
