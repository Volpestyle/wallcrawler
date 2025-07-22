import { NextResponse } from 'next/server';
import { storage } from '@/lib/storage';

export async function GET() {
    try {
        const activities = storage.getActivities();
        return NextResponse.json({ activities });
    } catch (error) {
        console.error('Failed to get activities:', error);
        return NextResponse.json(
            { error: 'Failed to get activities' },
            { status: 500 }
        );
    }
} 