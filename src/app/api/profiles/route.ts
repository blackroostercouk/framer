import { NextResponse } from 'next/server';

// Allow requests from both Framer preview and production domains
const ALLOWED_ORIGINS = [
  'https://mkyigitoglu.framer.website',
  'https://framercanvas.com',
  'https://framer.com'
];

function withCors(res: NextResponse, request: Request) {
  const origin = request.headers.get('origin');
  const requestOrigin = ALLOWED_ORIGINS.includes(origin || '') ? origin : ALLOWED_ORIGINS[0];
  
  const response = new NextResponse(res.body, res);
  response.headers.set('Access-Control-Allow-Origin', requestOrigin || '*');
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  response.headers.set('Access-Control-Allow-Credentials', 'true');
  response.headers.set('Access-Control-Max-Age', '86400');
  return response;
}

export async function OPTIONS(request: Request) {
  return withCors(new NextResponse(null, { status: 204 }), request);
}

export async function GET(request: Request) {
  const apiKey = process.env.KLAVIYO_API_KEY;
  
  if (!apiKey) {
    return withCors(NextResponse.json(
      { error: 'Klaviyo API key is not configured' },
      { status: 500 }
    ), request);
  }

  try {
    const response = await fetch('https://a.klaviyo.com/api/profiles/', {
      headers: {
        'Authorization': `Klaviyo-API-Key ${apiKey}`,
        'Accept': 'application/json',
        'revision': '2024-10-15'
      },
      cache: 'no-store'
    });

    if (!response.ok) {
      const error = await response.json();
      return withCors(NextResponse.json(
        { error: error.message || 'Failed to fetch profiles' },
        { status: response.status }
      ), request);
    }

    const data = await response.json();
    return withCors(NextResponse.json(data), request);
  } catch (error) {
    console.error('Error fetching Klaviyo profiles:', error);
    return withCors(NextResponse.json(
      { error: error instanceof Error ? error.message : 'An error occurred' },
      { status: 500 }
    ), request);
  }
}

export async function POST(request: Request) {
  try {
    const apiKey = process.env.KLAVIYO_API_KEY;
    if (!apiKey) {
      return withCors(NextResponse.json(
        { message: 'KLAVIYO_API_KEY is not configured on the server' },
        { status: 500 }
      ), request);
    }

    const body = await request.json().catch(() => ({}));
    const { email, first_name, last_name, subscribe, list_id } = body || {};

    if (!email || typeof email !== 'string') {
      return withCors(NextResponse.json({ message: 'Email is required' }, { status: 400 }), request);
    }

    // 1) Create profile (idempotent-ish: if conflict, we proceed)
    const createResp = await fetch('https://a.klaviyo.com/api/profiles/', {
      method: 'POST',
      headers: {
        'Authorization': `Klaviyo-API-Key ${apiKey}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'revision': '2024-10-15'
      },
      body: JSON.stringify({
        data: {
          type: 'profile',
          attributes: {
            email,
            first_name: first_name || undefined,
            last_name: last_name || undefined,
          },
        },
      }),
    });

    let profileJson: any = null;
    if (!createResp.ok) {
      if (createResp.status === 409) {
        // Profile exists: search by email
        const searchResp = await fetch(
          `https://a.klaviyo.com/api/profiles/?filter=equals(email,\"${encodeURIComponent(email)}\")`,
          {
            headers: {
              'Authorization': `Klaviyo-API-Key ${apiKey}`,
              'Accept': 'application/json',
              'revision': '2024-10-15',
            },
            cache: 'no-store',
          }
        );
        if (!searchResp.ok) {
          const t = await searchResp.text();
          return withCors(NextResponse.json(
            { message: 'Failed to upsert profile (search)', details: t },
            { status: searchResp.status }
          ), request);
        }
        profileJson = await searchResp.json();
      } else {
        const t = await createResp.text();
        return withCors(NextResponse.json(
          { message: 'Failed to create profile', details: t },
          { status: createResp.status }
        ), request);
      }
    } else {
      profileJson = await createResp.json();
    }

    const profileData = profileJson?.data || profileJson;
    const profileId = profileData?.id;

    // 2) Optionally subscribe to a list (double opt-in behavior depends on list settings)
    let subscribeWarning: string | undefined;
    let subscribed = false;
    let subscribeResult: any = undefined;
    if (subscribe && list_id) {
      const v2Url = `https://a.klaviyo.com/api/v2/list/${encodeURIComponent(list_id)}/subscribe`;
      const subPayload = {
        api_key: apiKey,
        confirm_optin: true,
        update_existing: true,
        profiles: [
          {
            email,
            first_name: first_name || undefined,
            last_name: last_name || undefined,
          },
        ],
      };
      const subResp = await fetch(v2Url, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(subPayload),
      });

      const subText = await subResp.text();
      try {
        subscribeResult = JSON.parse(subText);
      } catch {
        subscribeResult = subText;
      }

      if (!subResp.ok) {
        subscribeWarning = `Failed to subscribe to list (status ${subResp.status}).`;
      } else {
        subscribed = true;
      }
    }

    // 3) Fetch latest profile email marketing status to help diagnose DOI
    let emailMarketingStatus: any = undefined;
    try {
      const statusResp = await fetch(
        `https://a.klaviyo.com/api/profiles/?filter=equals(email,\"${encodeURIComponent(email)}\")`,
        {
          headers: {
            'Authorization': `Klaviyo-API-Key ${apiKey}`,
            'Accept': 'application/json',
            'revision': '2024-10-15',
          },
          cache: 'no-store',
        }
      );
      if (statusResp.ok) {
        const statusJson = await statusResp.json();
        const item = Array.isArray(statusJson?.data) ? statusJson.data[0] : statusJson?.data;
        const marketing = item?.attributes?.subscriptions?.email?.marketing;
        emailMarketingStatus = marketing || null;
      }
    } catch (e) {
      // non-fatal
    }

    return withCors(NextResponse.json({
      message: 'ok',
      profile: profileJson,
      profile_id: profileId,
      subscribed,
      subscribe_result: subscribeResult,
      email_marketing_status: emailMarketingStatus,
      warning: subscribeWarning
    }), request);
  } catch (err: any) {
    console.error('Error creating profile:', err);
    return withCors(NextResponse.json(
      { message: 'Unexpected error creating profile', details: err?.message || String(err) },
      { status: 500 }
    ), request);
  }
}