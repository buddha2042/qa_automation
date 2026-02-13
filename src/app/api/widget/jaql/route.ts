import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  console.log("=================================================");
  console.log("[SISENSE PROXY] API CALLED");
  console.log("Time:", new Date().toISOString());

  // Timeout protection (45 seconds)
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 45000);

  try {
    const startTime = Date.now();

    const body = await req.json();
    let { baseUrl, token, datasource, jaql } = body;

    console.log("[SISENSE PROXY] Base URL:", baseUrl);
    console.log("[SISENSE PROXY] Datasource:", datasource);
    console.log("[SISENSE PROXY] Metadata Count:", jaql?.metadata?.length || 0);

    // DATASOURCE NAME
    const urlSegment = datasource?.includes('/')
      ? datasource.split('/').pop()
      : datasource;

    const encodedDs = encodeURIComponent(urlSegment || '');
    const url = `${baseUrl}/api/datasources/${encodedDs}/jaql`;

    console.log("[SISENSE PROXY] Final URL:", url);

    // JAQL TRANSFORMATIONS
    if (jaql && jaql.metadata) {
      if (
        jaql.datasource &&
        !jaql.datasource.fullname.startsWith('localhost/')
      ) {
        jaql.datasource.fullname = `localhost/${jaql.datasource.fullname}`;
      }

      jaql.metadata = jaql.metadata.map((item: any, index: number) => {
        if (item.panel === 'categories') item.panel = 'rows';

        if (item.panel !== 'scope' && item.field) {
          item.field.index = index;
          if (item.jaql?.dim) {
            item.field.id = item.jaql.dim;
          }
        }

        if (item.panel === 'rows' && item.jaql) {
          item.jaql.pv = {
            "Visible in View>Yes": 2,
            "Aggregation>Count": 2
          };
        }

        if (item.panel === 'scope' && item.jaql && !item.jaql.datasource) {
          item.jaql.datasource = jaql.datasource;
        }

        return item;
      });
    }

    console.log("[SISENSE PROXY] Executing JAQL request...");

    //  FETCH SISENSE
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(jaql),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    const duration = Date.now() - startTime;
    console.log(`[SISENSE PROXY] Response received in ${duration}ms`);
    console.log("[SISENSE PROXY] HTTP Status:", response.status);

    //  HANDLE NON-JSON RESPONSES
    const contentType = response.headers.get("content-type");

    if (!contentType || !contentType.includes("application/json")) {
      const errorText = await response.text();
      console.error("[SISENSE PROXY] Non-JSON Response:");
      console.error(errorText.substring(0, 300));

      return NextResponse.json(
        { error: "Sisense returned invalid format (check Base URL or Datasource)." },
        { status: response.status }
      );
    }

    const data = await response.json();

    if (!response.ok) {
      console.error("[SISENSE PROXY] Sisense API Error:");
      console.error(JSON.stringify(data, null, 2));

      return NextResponse.json(
        {
          error: data?.error?.message || data?.message || "Sisense Execution Error",
          details: data
        },
        { status: response.status }
      );
    }

    console.log(`[SISENSE PROXY] SUCCESS - Rows Received: ${data?.values?.length || 0}`);
    console.log("=================================================");

    return NextResponse.json({ data });

  } catch (error: any) {
    clearTimeout(timeoutId);

    if (error.name === 'AbortError') {
      console.error("[SISENSE PROXY]  TIMEOUT after 45 seconds");
      console.log("=================================================");
      return NextResponse.json(
        { error: "Sisense query timed out (Request took too long)." },
        { status: 504 }
      );
    }

    console.error("[SISENSE PROXY] CRITICAL ERROR:", error.message);
    console.log("=================================================");

    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
