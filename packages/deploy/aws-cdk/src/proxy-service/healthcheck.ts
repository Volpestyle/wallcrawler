#!/usr/bin/env bun

// Simple health check for the proxy service
async function checkHealth() {
  try {
    const response = await fetch('http://localhost:8080/health');
    if (response.ok) {
      process.exit(0);
    } else {
      console.error(`Health check failed with status: ${response.status}`);
      process.exit(1);
    }
  } catch (error) {
    console.error('Health check failed:', error);
    process.exit(1);
  }
}

checkHealth();
