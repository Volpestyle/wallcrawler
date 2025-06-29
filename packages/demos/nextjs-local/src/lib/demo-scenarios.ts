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
    title: 'Act Method Demo',
    description: 'Perform actions on web pages using natural language - clicking, typing, navigation',
    defaultValues: {
      url: 'https://www.saucedemo.com',
      command: 'login with username standard_user and password secret_sauce',
    },
    exampleCommands: [
      'Click on the first product in the list',
      'Type "hello world" in the search box and press enter',
      'Click the "Add to cart" button for the backpack',
      'Navigate to the shopping cart page',
      'Scroll down to the bottom of the page',
    ],
  },
  form: {
    title: 'Observe Method Demo',
    description: 'Observe and describe elements on the page without taking actions',
    defaultValues: {
      url: 'https://books.toscrape.com',
      command: 'Describe all the books visible on the page and their properties',
    },
    exampleCommands: [
      'Describe all the books visible on the page',
      'Find all the navigation links and describe them',
      'Observe the page structure and identify key sections',
      'Look for any error messages or notifications',
      'Identify all interactive elements on the page',
    ],
  },
  navigation: {
    title: 'Act + Extract Combo Demo',
    description: 'Combine actions with data extraction for complex workflows',
    defaultValues: {
      url: 'https://www.wikipedia.org',
      command: 'Search for "Artificial Intelligence", click the first result, and extract the main article summary',
    },
    exampleCommands: [
      'Search for "Machine Learning" and extract the key concepts from the article',
      'Navigate to "Random article" and extract the title and first paragraph',
      'Search for "Web scraping" and get the definition',
      'Find the "Today\'s featured article" and extract its summary',
    ],
  },
  extraction: {
    title: 'Extract Method Demo',
    description: 'Extract structured data that matches a specific Zod schema',
    defaultValues: {
      url: 'https://books.toscrape.com',
      command: 'Extract all books on the page with their titles, prices, and ratings',
      schema: `z.object({
  books: z.array(z.object({
    title: z.string(),
    price: z.string(),
    rating: z.string(),
    availability: z.string().optional()
  }))
})`,
    },
    exampleCommands: [
      'Extract all books with title, price, and rating',
      'Get only the books that are "In stock"',
      'Extract the navigation categories available',
      'Get books with 4 or 5-star ratings only',
    ],
  },
};

export function getDemoScenario(scenario: keyof typeof scenarios): DemoScenario {
  return scenarios[scenario] || scenarios.scraping;
}
