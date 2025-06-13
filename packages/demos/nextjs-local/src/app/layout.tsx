import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'WallCrawler Demo - Local Provider',
  description: 'AI-powered browser automation with WallCrawler using local infrastructure',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <div className="min-h-screen bg-gray-50">
          <header className="bg-white shadow-sm border-b">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex items-center justify-between h-16">
                <div className="flex items-center">
                  <h1 className="text-xl font-semibold text-gray-900">
                    WallCrawler Demo
                  </h1>
                  <span className="ml-3 text-sm text-gray-500">
                    Local Provider
                  </span>
                </div>
                <nav className="flex space-x-4">
                  <a href="#features" className="text-gray-600 hover:text-gray-900">
                    Features
                  </a>
                  <a href="#docs" className="text-gray-600 hover:text-gray-900">
                    Documentation
                  </a>
                  <a 
                    href="https://github.com/Volpestyle/wallcrawler" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-gray-600 hover:text-gray-900"
                  >
                    GitHub
                  </a>
                </nav>
              </div>
            </div>
          </header>
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}