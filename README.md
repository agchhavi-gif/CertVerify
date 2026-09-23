# CertVerify Portal

Two standalone pages — a public **Verify Portal** and a simple **Admin Upload Page**. No login, no complex admin dashboard.

---

## How It Works

### Admin Page (`/admin`)
1. Admin opens `/admin` directly in the browser
2. Uploads a certificate file (PDF or image)
3. System extracts **Certificate ID**, **Participant Name**, and **Issue Date** from the certificate via OCR / PDF parsing
4. Admin reviews the extracted fields and corrects any errors
5. Admin clicks **Confirm & Save** — the three fields are stored in the database

### Verify Portal (`/`)
1. User opens the root URL
2. Enters their **Name** and **Certificate ID** as printed on their certificate
3. System checks against the database
4. Result shown: ✅ **Valid** or ❌ **Invalid**

---

## Tech Stack

| Layer    | Tech                                    |
|----------|-----------------------------------------|
| Frontend | React 18, React Router v6, CSS Modules  |
| Backend  | Node.js, Express                        |
| Database | PostgreSQL                              |
| OCR      | Tesseract.js (images), pdf-parse (PDFs) |

---

## Project Structure

```
verify-portal/
├── backend/
│   ├── src/
│   │   ├── controllers/
│   │   │   ├── certificateController.js  # upload+extract, save
│   │   │   └── verifyController.js       # public verify
│   │   ├── db/
│   │   │   ├── index.js                  # PostgreSQL pool
│   │   │   └── migrate.js                # auto-create table
│   │   ├── middleware/
│   │   │   └── upload.js                 # multer file handler
│   │   ├── routes/
│   │   │   ├── admin.js                  # /api/admin/upload + /api/admin/save
│   │   │   └── verify.js                 # /api/verify
│   │   ├── utils/
│   │   │   └── extractCertData.js        # OCR + PDF extraction
│   │   └── index.js
│   ├── .env
│   └── package.json
│
└── frontend/
    └── src/
        ├── api/axios.js
        ├── pages/
        │   ├── AdminPage.js              # Upload + review + save (single page)
        │   ├── AdminPage.module.css
        │   ├── VerifyPage.js             # Public verify
        │   └── VerifyPage.module.css
        └── App.js
```

---

## Database Schema

Only one table, only three fields that matter:

```sql
CREATE TABLE certificates (
  id               SERIAL PRIMARY KEY,
  certificate_id   VARCHAR(100) UNIQUE NOT NULL,  -- from the certificate
  recipient_name   VARCHAR(255) NOT NULL,
  issue_date       DATE NOT NULL,
  created_at       TIMESTAMP DEFAULT NOW()
);
```

---

## Setup

### 1. PostgreSQL

Install PostgreSQL and create the database:

```sql
CREATE DATABASE cert_verify;
```

### 2. Backend

```bash
cd backend
npm install
# Edit .env — set DB_PASSWORD to your PostgreSQL password
npm run dev
```

Tables are created automatically on first start.

### 3. Frontend

```bash
cd frontend
npm install
npm start
```

---

## Environment Variables (`backend/.env`)

```env
PORT=5000
NODE_ENV=development

DB_HOST=localhost
DB_PORT=5432
DB_NAME=cert_verify
DB_USER=postgres
DB_PASSWORD=postgres123
```

---

## API Reference

### Public

| Method | Endpoint      | Body                        | Description          |
|--------|---------------|-----------------------------|----------------------|
| POST   | `/api/verify` | `{ name, certificateId }`   | Verify a certificate |

**Valid response:**
```json
{
  "valid": true,
  "message": "Certificate is valid.",
  "certificate": {
    "certificateId": "UC-123456789",
    "recipientName": "John Doe",
    "issueDate": "2024-01-15"
  }
}
```

**Invalid response:**
```json
{
  "valid": false,
  "message": "No certificate found matching the provided name and Certificate ID."
}
```

---

### Admin (no auth required)

| Method | Endpoint             | Description                                      |
|--------|----------------------|--------------------------------------------------|
| POST   | `/api/admin/upload`  | Upload file → returns extracted fields for review |
| POST   | `/api/admin/save`    | Save reviewed fields to database                 |

**Upload response:**
```json
{
  "message": "Extraction complete. Review the fields below before saving.",
  "extracted": {
    "certificateId": "UC-123456789",
    "recipientName": "John Doe",
    "issueDate": "2024-01-15"
  }
}
```

**Save body:**
```json
{
  "certificateId": "UC-123456789",
  "recipientName": "John Doe",
  "issueDate": "2024-01-15"
}
```

---

## URLs

| Page           | URL                      |
|----------------|--------------------------|
| Verify Portal  | `http://localhost:3000/` |
| Admin Upload   | `http://localhost:3000/admin` |

---

## Certificate ID Extraction

The system looks for these patterns in the certificate text:

```
Certificate No: ABC-1234
Cert ID: XYZ-9876
Certificate Number: 2024-ABC-001
ID: UC-123456789
No.: CERT-2024-001
```

If your certificates use a different format, update the patterns in:
```
backend/src/utils/extractCertData.js  →  certIdPatterns array
```
