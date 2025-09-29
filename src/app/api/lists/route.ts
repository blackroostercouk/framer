import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const apiKey = process.env.KLAVIYO_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { message: 'KLAVIYO_API_KEY is not configured on the server' },
        { status: 500 }
      );
    }

    const resp = await fetch('https://a.klaviyo.com/api/lists', {
      headers: {
        Accept: 'application/json',
        Authorization: `Klaviyo-API-Key ${apiKey}`,
        // Use the latest stable revision you support
        revision: '2024-10-15',
      },
      // Prevent Next.js fetch caching for dynamic data
      cache: 'no-store',
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return NextResponse.json(
        { message: 'Failed to fetch Klaviyo lists', details: errText },
        { status: resp.status }
      );
    }

    const json = await resp.json();
    const items = Array.isArray(json?.data)
      ? json.data.map((item: any) => ({ id: item?.id, name: item?.attributes?.name }))
      : [];

    return NextResponse.json({ data: items });
  } catch (err: any) {
    return NextResponse.json(
      { message: 'Unexpected error fetching lists', details: err?.message || String(err) },
      { status: 500 }
    );
  }
}
