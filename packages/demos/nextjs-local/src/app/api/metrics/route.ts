import { NextResponse } from 'next/server';
import { storage } from '@/lib/storage';

export async function GET() {
    try {
        const globalMetrics = storage.getGlobalMetrics();
        return NextResponse.json({ metrics: globalMetrics });
    } catch (error) {
        console.error('Failed to get global metrics:', error);
        return NextResponse.json(
            { error: 'Failed to get global metrics' },
            { status: 500 }
        );
    }
} 