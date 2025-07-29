import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { ErrorBoundary } from "@/components/error-boundary";
import { MainLayout } from "@/components/layout/main-layout";
import { Toaster } from "@/components/ui/toaster";
import { NewSessionModal } from "@/components/sessions/new-session-modal";
import { NewWorkflowModal } from "@/components/workflows/new-workflow-modal";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["200", "300", "400", "500", "600"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["300", "400", "500"],
});

export const metadata: Metadata = {
  title: "Wallcrawler Dashboard",
  description: "Test Wallcrawler features through Stagehand",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} antialiased`}
      >
        <ErrorBoundary>
          <MainLayout>
            {children}
          </MainLayout>
          <Toaster />
          <NewSessionModal />
          <NewWorkflowModal />
        </ErrorBoundary>
      </body>
    </html>
  );
}
