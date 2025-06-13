export interface DemoScenario {
  title: string;
  description: string;
  defaultValues: {
    url: string;
    command: string;
    schema?: string;
  };
  exampleCommands: string[];
}

const scenarios: Record<string, DemoScenario> = {
  scraping: {
    title: 'Web Scraping',
    description: 'Extract information from web pages using natural language commands',
    defaultValues: {
      url: 'https://books.toscrape.com',
      command: 'Navigate to the first book and extract its title, price, and availability',
    },
    exampleCommands: [
      'Extract all book titles and prices from the page',
      'Find the most expensive book and get its details',
      'Navigate to the "Travel" category and list all books',
      'Get the rating and stock information for each book',
    ],
  },
  form: {
    title: 'Form Automation',
    description: 'Automatically fill and submit forms with structured data',
    defaultValues: {
      url: 'https://www.saucedemo.com',
      command: 'Login with username "standard_user" and password "secret_sauce", then add the first product to cart',
    },
    exampleCommands: [
      'Fill the login form with the provided credentials',
      'Complete the checkout process with test information',
      'Add multiple items to cart and proceed to checkout',
      'Filter products by price and select the cheapest one',
    ],
  },
  navigation: {
    title: 'Multi-Step Navigation',
    description: 'Navigate through multiple pages and perform complex workflows',
    defaultValues: {
      url: 'https://www.wikipedia.org',
      command: 'Search for "Artificial Intelligence", navigate to the page, and extract the first paragraph of the article',
    },
    exampleCommands: [
      'Navigate through multiple links and collect information',
      'Follow a specific path: Home -> Category -> Product -> Details',
      'Search for a term and navigate to the most relevant result',
      'Complete a multi-step wizard or form process',
    ],
  },
  extraction: {
    title: 'Structured Data Extraction',
    description: 'Extract data that matches a specific schema using Zod validation',
    defaultValues: {
      url: 'https://hacker-news.firebaseio.com/v0/topstories.json',
      command: 'Extract the top 5 stories with their titles, scores, and authors',
      schema: `z.object({
  stories: z.array(z.object({
    title: z.string(),
    score: z.number(),
    author: z.string(),
    url: z.string().optional(),
    comments: z.number().optional()
  })).max(5)
})`,
    },
    exampleCommands: [
      'Extract product data matching the provided schema',
      'Get structured data from tables or lists',
      'Parse and validate API responses',
      'Extract nested data structures with relationships',
    ],
  },
};

export function getDemoScenario(scenario: keyof typeof scenarios): DemoScenario {
  return scenarios[scenario] || scenarios.scraping;
}