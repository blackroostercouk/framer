import { NextResponse } from 'next/server';

// Allow requests from your Framer site
const ALLOWED_ORIGIN = 'https://mkyigitoglu.framer.website';

function withCors(res: NextResponse) {
  res.headers.set('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.headers.set('Access-Control-Max-Age', '86400');
  return res;
}

export async function OPTIONS() {
  return withCors(new NextResponse(null, { status: 204 }));
}

export async function GET() {
  const apiKey = process.env.KLAVIYO_API_KEY;
  
  if (!apiKey) {
    return withCors(NextResponse.json(
      { error: 'Klaviyo API key is not configured' },
      { status: 500 }
    ));
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
      ));
    }

    const data = await response.json();
    return withCors(NextResponse.json(data));
  } catch (error) {
    console.error('Error fetching Klaviyo profiles:', error);
    return withCors(NextResponse.json(
      { error: error instanceof Error ? error.message : 'An error occurred' },
      { status: 500 }
    ));
  }
}

export async function POST(req: Request) {
  try {
    const apiKey = process.env.KLAVIYO_API_KEY;
    if (!apiKey) {
      return withCors(NextResponse.json(
        { message: 'KLAVIYO_API_KEY is not configured on the server' },
        { status: 500 }
      ));
    }

    const body = await req.json().catch(() => ({}));
    const { email, first_name, last_name, subscribe, list_id } = body || {};

    if (!email || typeof email !== 'string') {
      return withCors(NextResponse.json({ message: 'Email is required' }, { status: 400 }));
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
          ));
        }
        profileJson = await searchResp.json();
      } else {
        const t = await createResp.text();
        return withCors(NextResponse.json(
          { message: 'Failed to create profile', details: t },
          { status: createResp.status }
        ));
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
      warning: subscribeWarning,
      subscribe_result: subscribeResult,
      email_marketing_status: emailMarketingStatus,
    }));
  } catch (err: any) {
    console.error('Error creating profile:', err);
    return withCors(NextResponse.json(
      { message: 'Unexpected error creating profile', details: err?.message || String(err) },
      { status: 500 }
    ));
  }
}