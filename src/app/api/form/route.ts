import { NextResponse } from 'next/server';

export async function GET() {
    const apiKey = process.env.KLAVIYO_API_KEY;
    
    if (!apiKey) {
      return NextResponse.json(
        { error: 'Klaviyo API key is not configured' },
        { status: 500 }
      );
    }
  
    try {
      const response = await fetch('https://a.klaviyo.com/api/forms/SDnX9G', {
        headers: {
          'Authorization': `Klaviyo-API-Key ${apiKey}`,
          'Accept': 'application/vnd.api+json',
          'revision': '2025-07-15.pre'
        },
        cache: 'no-store'
      });
  
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to fetch profiles');
      }
  
      const data = await response.json();
      return NextResponse.json(data);
    } catch (error) {
      console.error('Error fetching Klaviyo profiles:', error);
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'An error occurred' },
        { status: 500 }
      );
    }
  }
  