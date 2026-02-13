## Stryker SisenseDashboard testion App

React/Next.js front end with a Flask + Gemini backend to test structured fields from SisenseDashboards (PNG/JPG/PDF), allow editing, and save to SQLite.

### Prerequisites
- Node 18+
- Python 3.10+
- A Google Gemini API key

### Environment Variables
Create `stryker-ai/.env.local` with:

```
NEXT_PUBLIC_API_BASE=http://localhost:5001
```

Create `stryker-ai-back/.env` (or set in your shell) with:

```
GEMINI_API_KEY=your_api_key_here
PORT=5001
```

### Backend: Flask

1) Install deps:

```
pip install -r stryker-ai-back/requirements.txt
```

2) Run the API:

```
python stryker-ai-back/app.py
```

The API will start at http://localhost:5001

Endpoints:
- POST `/process` (multipart file): tests header + lines
- POST `/save` (JSON): saves to SQLite
- GET `/orders` and `/orders/:id`
- GET `/health`

### Frontend: Next.js

Install and run:

```
cd stryker-ai
npm install
npm run dev
```

Open http://localhost:3000

### Demo Assets
Sample SisenseDashboard(s) are in `public/SisenseDashboards/`. You can download as image/PDF or use your own. Supported: PNG, JPG, PDF.

### Notes
- PDF text is tested with `PyPDF2` and then parsed by Gemini.
- Images are sent to Gemini Vision directly.
- Data schema mimics SalesOrderHeader and SalesOrderDetail (common fields such as order_number, dates, customer, totals, and line items with quantity, unit price, total).
# qa_automation_app_shared
# AssureInsightsTools
