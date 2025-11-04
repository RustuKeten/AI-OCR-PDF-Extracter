# PDF Extractor AI

Advanced AI-powered PDF data extraction and resume parsing application built with Next.js, Prisma, NextAuth, and Supabase. Extract structured resume data from both text-based and image-based PDFs using OpenAI's GPT-4 and Vision APIs.

## ✨ Features

### Core Functionality

- ✅ **Smart PDF Extraction**: Extract structured data from PDF resumes using OpenAI GPT-4
- ✅ **Image-Based PDF Support**: OCR processing for scanned/image-based PDFs using GPT-4 Vision
- ✅ **Dual Processing Modes**: Automatically detects and handles both text-based and image-based PDFs
- ✅ **Structured JSON Output**: Returns well-organized JSON data following a consistent schema order

### User Management

- ✅ **Authentication**: Secure user authentication with NextAuth.js (email/password)
- ✅ **Credits System**: Credit-based processing (100 credits per file, 1000 credits for new users)
- ✅ **User Dashboard**: Track files, credits, and processing history
- ✅ **File History**: Complete history of all uploaded and processed files

### User Interface

- ✅ **Modern UI**: Beautiful, responsive interface with dark mode support
- ✅ **Theme Support**: Light, dark, and system theme preferences
- ✅ **File Management**: View, download, and delete uploaded files
- ✅ **Resume Data Viewer**: Modal view for extracted resume data with JSON copy functionality
- ✅ **Real-time Updates**: Auto-refresh for processing status
- ✅ **Toast Notifications**: User-friendly feedback for all actions
- ✅ **Landing Page**: Professional marketing page with features and benefits

### Database & Storage

- ✅ **PostgreSQL Database**: Robust database via Supabase with Prisma ORM
- ✅ **File Metadata**: Track file size, upload date, and processing status
- ✅ **Data Persistence**: All extracted data saved to database
- ✅ **Complete History**: Full audit trail of all file operations

## 🛠️ Tech Stack

- **Framework**: Next.js 16 (App Router)
- **Database**: PostgreSQL (Supabase)
- **ORM**: Prisma 6.18.0
- **Authentication**: NextAuth.js 4.24.12
- **Styling**: Tailwind CSS v4
- **AI Models**:
  - OpenAI GPT-4o-mini (text-based PDFs)
  - OpenAI GPT-4o (image-based PDFs with Vision API)
- **UI Components**: Custom components with Lucide React icons
- **File Upload**: react-dropzone for drag-and-drop functionality
- **Notifications**: react-hot-toast
- **Theme**: next-themes

## 📋 Prerequisites

- **Node.js**: 18+
- **Package Manager**: npm or yarn
- **Supabase Account**: For PostgreSQL database ([sign up here](https://supabase.com))
- **OpenAI API Key**: For PDF extraction ([get one here](https://platform.openai.com/api-keys))

## 🚀 Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/RustuKeten/AI-OCR-PDF-Extracter.git
cd AI-OCR-PDF-Extracter
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Set Up Environment Variables

Create a `.env.local` file in the root directory and copy from `.env.example`:

```bash
cp .env.example .env.local
```

Then update `.env.local` with your actual values. See `.env.example` for all required variables.

### 4. Set Up Stripe (Optional but Recommended)

1. Create a Stripe account at [stripe.com](https://stripe.com)
2. Navigate to **Developers** > **API Keys** (make sure you're in **Test Mode**)
3. Copy your **Publishable key** and **Secret key** (starts with `pk_test_` and `sk_test_`)
4. Create two products in Stripe Dashboard:
   - **Basic Plan**: $10/month → Copy the Price ID (starts with `price_`)
   - **Pro Plan**: $20/month → Copy the Price ID (starts with `price_`)
5. Set up webhook endpoint:
   - Go to **Developers** > **Webhooks** > **Add endpoint**
   - Endpoint URL: `https://your-domain.com/api/webhooks/stripe`
   - Select events: `invoice.paid`, `customer.subscription.updated`, `customer.subscription.deleted`, `checkout.session.completed`, `customer.subscription.created`
   - Copy the **Signing secret** (starts with `whsec_`)
6. Update your `.env.local` file with all Stripe keys

### 5. Set Up Supabase Database

1. Create a new Supabase project at [supabase.com](https://supabase.com)
2. Navigate to **Settings** > **Database**
3. Copy the connection string from **Connection string** section (use "URI" format)
4. Update `DATABASE_URL` in your `.env.local` file

### 6. Run Database Migrations

```bash
# Generate Prisma Client
npm run prisma:generate

# Create initial migration and apply to database
npm run prisma:migrate

# (Optional) Open Prisma Studio to view/manage your database
npm run prisma:studio
```

### 7. Start Development Server

```bash
npm run dev
```

Open [http://localhost:3002](http://localhost:3002) in your browser.

## 📁 Project Structure

```
├── prisma/
│   └── schema.prisma              # Database schema (User, File, ResumeData, etc.)
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── auth/
│   │   │   │   └── [...nextauth]/
│   │   │   │       └── route.ts  # NextAuth API routes
│   │   │   ├── extract/
│   │   │   │   └── route.ts      # Direct PDF extraction API
│   │   │   └── files/
│   │   │       ├── route.ts      # GET: List user files
│   │   │       ├── upload/
│   │   │       │   └── route.ts  # POST: Upload & process file
│   │   │       ├── credits/
│   │   │       │   └── route.ts  # GET: Get user credits
│   │   │       └── [id]/
│   │   │           └── route.ts  # GET/DELETE: File operations
│   │   ├── auth/
│   │   │   ├── signin/
│   │   │   │   └── page.tsx      # Sign in/Sign up page
│   │   │   └── error/
│   │   │       └── page.tsx      # Auth error page
│   │   ├── dashboard/
│   │   │   └── page.tsx          # Main dashboard
│   │   ├── layout.tsx            # Root layout with providers
│   │   ├── page.tsx              # Home/landing page
│   │   └── globals.css           # Global styles & theme
│   ├── components/
│   │   ├── ui/                   # Reusable UI components
│   │   │   ├── button.tsx
│   │   │   ├── card.tsx
│   │   │   ├── input.tsx
│   │   │   ├── badge.tsx
│   │   │   ├── loading-spinner.tsx
│   │   │   └── pdf-uploader.tsx  # Drag-and-drop uploader
│   │   ├── dashboard/            # Dashboard-specific components
│   │   │   ├── stats-section.tsx     # Statistics cards
│   │   │   ├── upload-section.tsx    # Upload area
│   │   │   ├── files-section.tsx     # File history list
│   │   │   ├── resume-modal.tsx      # Resume data viewer
│   │   │   └── delete-confirm-modal.tsx
│   │   ├── home-page.tsx         # Landing page content
│   │   ├── footer.tsx            # Footer component
│   │   ├── navigation.tsx        # Navigation bar
│   │   ├── theme-toggle.tsx      # Theme switcher
│   │   ├── PdfUploader.tsx       # Original uploader (standalone)
│   │   └── providers/
│   │       └── session-provider.tsx  # Session & theme providers
│   ├── lib/
│   │   ├── auth.ts              # NextAuth configuration
│   │   ├── prisma.ts            # Prisma client singleton
│   │   └── utils.ts             # Utility functions (cn, etc.)
│   ├── types/
│   │   ├── resume.ts            # Resume data type definitions
│   │   └── next-auth.d.ts      # NextAuth type extensions
│   └── utils/
│       ├── resumeTemplate.ts    # Empty resume template generator
│       └── resumeOrder.ts      # JSON field reordering utility
├── test-extract-api.ts          # API testing script
└── package.json
```

## 📜 Available Scripts

- `npm run dev` - Start development server (port 3002)
- `npm run build` - Build for production (includes Prisma generation)
- `npm run start` - Start production server
- `npm run lint` - Run ESLint
- `npm run prisma:generate` - Generate Prisma Client
- `npm run prisma:migrate` - Create and apply database migrations
- `npm run prisma:studio` - Open Prisma Studio (database GUI)

## 💡 Usage Guide

### For End Users

1. **Visit Home Page**: Browse features and click "Try It Now"
2. **Sign Up**: Create an account with email and password (or sign in if you have one)
3. **Dashboard**: Access your personal dashboard with stats and file management
4. **Upload PDF**:
   - Drag and drop a PDF file or click to browse
   - Supports both text-based and image-based PDFs
   - Maximum file size: 10MB
5. **View Results**:
   - See processing status in real-time
   - View extracted data in a modal
   - Copy JSON data to clipboard
6. **File Management**:
   - View all uploaded files in history
   - Delete files when no longer needed
   - Track credits and processing stats

### For Developers

#### PDF Extraction API

**Direct Extraction** (no database save):

```bash
POST /api/extract
Content-Type: multipart/form-data
Body: file (PDF file)
```

**Upload & Save** (with database):

```bash
POST /api/files/upload
Content-Type: multipart/form-data
Headers: Cookie (session)
Body: file (PDF file)
```

#### File Management API

```bash
# List user files
GET /api/files

# Get file details & resume data
GET /api/files/[id]

# Delete file
DELETE /api/files/[id]

# Get user credits
GET /api/files/credits
```

## 🗄️ Database Schema

### Models

- **User**: User accounts with authentication credentials and credits

  - Fields: `id`, `email`, `name`, `password` (hashed), `credits`, `planType`, `createdAt`, etc.

- **File**: Uploaded PDF files metadata

  - Fields: `id`, `fileName`, `fileSize`, `fileType`, `status`, `uploadedAt`, `userId`, etc.
  - Status values: `uploaded`, `processing`, `completed`, `failed`

- **ResumeData**: Extracted resume data in JSON format

  - Fields: `id`, `userId`, `fileId`, `data` (JSON), `createdAt`, `updatedAt`
  - Structured JSON matching the ResumeData interface

- **ResumeHistory**: Complete audit trail of file operations

  - Fields: `id`, `userId`, `fileId`, `action`, `status`, `message`, `createdAt`
  - Actions: `upload`, `process`, `extract`, `delete`

- **Account, Session, VerificationToken**: NextAuth required models

### Relationships

- User → Files (one-to-many)
- File → ResumeData (one-to-one)
- User → ResumeData (one-to-many)
- User → ResumeHistory (one-to-many)
- File → ResumeHistory (one-to-many)

## 📊 Resume Data Schema

The extracted JSON follows this structure (in order):

```json
{
  "profile": {
    "name": "string",
    "surname": "string",
    "email": "string",
    "headline": "string",
    "professionalSummary": "string",
    "linkedIn": "string | null",
    "website": "string | null",
    "country": "string",
    "city": "string",
    "relocation": boolean,
    "remote": boolean
  },
  "workExperiences": [...],
  "educations": [...],
  "skills": [...],
  "licenses": [...],
  "languages": [...],
  "achievements": [...],
  "publications": [...],
  "honors": [...]
}
```

## 🔧 Configuration

### Credits System

- **New Users**: Start with 1000 credits
- **Cost per File**: 100 credits
- **Plan Types**: FREE (default), BASIC, PRO (for future implementation)

### File Processing

- **Text-Based PDFs**: Uses `gpt-4o-mini` for fast, cost-effective extraction
- **Image-Based PDFs**: Uses `gpt-4o` with Vision API for OCR
- **Auto-Detection**: Automatically detects PDF type and uses appropriate model
- **File Size Limit**: 10MB maximum (client-side validation)
- **Supported Format**: PDF only

### Large File Handling (Vercel Serverless Limits)

**Note**: Vercel serverless functions have a payload limit of approximately 4 MB. However, our application accepts PDF files up to 10 MB on the client side. Here's how we handle this:

1. **Client-Side Validation**: The uploader component validates file size (10 MB max) before upload
2. **Direct API Route Upload**: Files are uploaded directly to `/api/files/upload` using Next.js API routes, which handle FormData payloads
3. **Buffer Processing**: The API route processes the file buffer directly in memory without intermediate storage
4. **Streaming Support**: For files larger than 4 MB, the FormData is streamed directly to the serverless function, avoiding the 4 MB payload limit

**For Production**: If you need to handle files larger than 10 MB, consider:

- Using Vercel Blob Storage for file uploads
- Implementing chunked uploads
- Using a dedicated file storage service (AWS S3, Cloudinary, etc.)

### Theme Settings

- Default theme: Dark
- Supports: Light, Dark, System (auto-detect)
- Preference saved in localStorage

## 💳 Stripe Integration

### Subscription Plans

The application supports three subscription tiers:

| Plan  | Credits | Price     | PDF Extractions |
| ----- | ------- | --------- | --------------- |
| FREE  | 1,000   | $0        | ~10             |
| BASIC | 10,000  | $10/month | ~100            |
| PRO   | 20,000  | $20/month | ~200            |

### How Credits Work

1. **Credit Cost**: Each successful PDF extraction costs **100 credits**
2. **Credit Deduction**: Credits are deducted **after** successful extraction (not before)
3. **Insufficient Credits**: If a user has less than 100 credits, they receive a friendly error message encouraging them to subscribe or wait for subscription renewal
4. **Monthly Renewal**: When a subscription renews (invoice.paid webhook), credits are automatically added to the user's account

### Subscription Flow

1. **Sign Up**: User creates account (FREE plan with 1,000 credits)
2. **Subscribe**: User navigates to Settings page and selects a plan
3. **Checkout**: User is redirected to Stripe Checkout to complete payment
4. **Webhook Processing**:
   - `checkout.session.completed` webhook fires
   - Subscription ID saved to user record
   - Credits added to account (10,000 for BASIC, 20,000 for PRO)
   - Plan type updated
5. **Monthly Renewal**:
   - `invoice.paid` webhook fires each month
   - Credits automatically added based on plan
6. **Upgrade/Downgrade**:
   - Users can upgrade from BASIC → PRO
   - Existing subscription is canceled and new one is created
   - `customer.subscription.updated` webhook updates plan type
7. **Cancellation**:
   - Users can cancel via Stripe Customer Portal
   - `customer.subscription.deleted` webhook resets plan to FREE
   - Remaining credits are kept

### Webhook Events Handled

| Event                           | Action                                               |
| ------------------------------- | ---------------------------------------------------- |
| `checkout.session.completed`    | Activate subscription, add credits, update plan type |
| `invoice.paid`                  | Add monthly credits on renewal                       |
| `customer.subscription.updated` | Update plan type when changed                        |
| `customer.subscription.deleted` | Reset to FREE plan, clear subscription ID            |
| `customer.subscription.created` | Backup handler for subscription creation             |

### Stripe API Endpoints

- `POST /api/stripe/checkout` - Create Stripe Checkout session for subscription
- `POST /api/stripe/portal` - Create Stripe Customer Portal session for billing management
- `POST /api/webhooks/stripe` - Handle Stripe webhook events

### Testing Stripe Integration

1. Use Stripe **Test Mode** (never use live mode in development)
2. Use Stripe test cards from the [official Stripe documentation](https://docs.stripe.com/testing#cards):

   #### Most Common Test Cards

   | Brand                 | Card Number           | CVC          | Expiry Date     | Description        |
   | --------------------- | --------------------- | ------------ | --------------- | ------------------ |
   | Visa                  | `4242 4242 4242 4242` | Any 3 digits | Any future date | Successful payment |
   | Visa (debit)          | `4000 0566 5556 5556` | Any 3 digits | Any future date | Successful payment |
   | Mastercard            | `5555 5555 5555 4444` | Any 3 digits | Any future date | Successful payment |
   | Mastercard (2-series) | `2223 0031 2200 3222` | Any 3 digits | Any future date | Successful payment |
   | American Express      | `3782 8224 6310 005`  | Any 4 digits | Any future date | Successful payment |
   | Discover              | `6011 1111 1111 1117` | Any 3 digits | Any future date | Successful payment |

   #### Test Cards for Different Scenarios

   | Card Number           | Scenario           | Description                                 |
   | --------------------- | ------------------ | ------------------------------------------- |
   | `4242 4242 4242 4242` | Success            | Payment succeeds                            |
   | `4000 0000 0000 0002` | Card declined      | Generic decline                             |
   | `4000 0000 0000 9995` | Insufficient funds | Card has insufficient funds                 |
   | `4000 0000 0000 0069` | Expired card       | Card has expired                            |
   | `4000 0000 0000 0127` | Incorrect CVC      | CVC is incorrect                            |
   | `4000 0000 0000 0119` | Processing error   | An error occurred while processing the card |
   | `4000 0025 0000 3155` | 3D Secure required | Requires 3D Secure authentication           |

   **How to Use:**

   - Enter the card number in the Stripe Checkout form
   - Use any future expiry date (e.g., `12/34`)
   - Use any 3-digit CVC (e.g., `123`) for Visa/Mastercard, or any 4-digit CVC for American Express
   - Use any valid email address
   - Use any valid billing address

   > **Note**: For a complete list of test cards including country-specific cards, declined cards, and 3D Secure testing, visit the [Stripe Testing Documentation](https://docs.stripe.com/testing#cards).

3. Test webhooks locally using Stripe CLI:
   ```bash
   stripe listen --forward-to localhost:3002/api/webhooks/stripe
   ```

## 🐛 Troubleshooting

### Common Issues

**"Unauthorized" Error**

- Make sure you're signed in
- Check that `NEXTAUTH_SECRET` is set correctly
- Verify session is valid

**"Insufficient credits" Error**

- Check your credits balance in the dashboard
- Each file costs 100 credits
- Contact admin to add more credits (for future implementation)

**"Failed to extract images" Error**

- Image-based PDF might be too large (>500KB base64)
- Try converting to text-based PDF
- Reduce image resolution or use smaller PDF

**Database Connection Error**

- Verify `DATABASE_URL` is correct
- Check Supabase project is active
- Ensure database is accessible (firewall settings)

**Empty JSON Response**

- PDF might not contain extractable text
- Try a different PDF file
- Check OpenAI API key is valid
- Verify API quota is not exceeded

## 🧪 Testing

### Test with cURL

```bash
# Test extraction endpoint
curl -X POST http://localhost:3002/api/extract \
  -F "file=@/path/to/resume.pdf"

# Test upload endpoint (requires authentication)
curl -X POST http://localhost:3002/api/files/upload \
  -H "Cookie: next-auth.session-token=your-session-token" \
  -F "file=@/path/to/resume.pdf"
```

## 🚢 Deployment

### Vercel Deployment Guide

### Quick Deployment Checklist

1. **Environment Variables** - Set all required variables in Vercel dashboard
2. **Database** - Run migrations: `npx prisma migrate deploy`
3. **Stripe Webhook** - Configure endpoint **after deployment**: `https://your-domain.vercel.app/api/webhooks/stripe`
4. **Stripe Products** - Create products in **Live Mode** and copy Price IDs
5. **Test** - Verify authentication, PDF upload, and subscription flows

### Environment Variables for Production

Make sure to set these in your Vercel project settings:

```env
# Database
DATABASE_URL="your-production-database-url"

# NextAuth
NEXTAUTH_URL="https://your-domain.vercel.app"
NEXTAUTH_SECRET="your-production-secret"  # Generate with: openssl rand -base64 32

# OpenAI
OPENAI_API_KEY="your-openai-api-key"

# Stripe (Live Mode for production)
STRIPE_SECRET_KEY="sk_live_your_stripe_secret_key"
STRIPE_PUBLIC_KEY="pk_live_your_stripe_public_key"
NEXT_PUBLIC_STRIPE_PUBLIC_KEY="pk_live_your_stripe_public_key"
STRIPE_WEBHOOK_SECRET="whsec_your_production_webhook_secret"
STRIPE_PRICE_BASIC="price_your_basic_monthly_price_id"
STRIPE_PRICE_PRO="price_your_pro_monthly_price_id"
```

### Important Notes

- ⚠️ **Webhook Endpoint**: Configure Stripe webhook **after deployment** with your Vercel URL
- ⚠️ **Live Mode**: Use Stripe **Live Mode** keys and Price IDs for production
- ⚠️ **Database**: Run `npx prisma migrate deploy` before first deployment
- ⚠️ **HTTPS**: Vercel automatically provides HTTPS (required for webhooks)

### Build for Production

```bash
npm run build
npm run start
```

### Database Migrations in Production

```bash
# Apply migrations to production database
DATABASE_URL="your-production-database-url" npx prisma migrate deploy

# Generate Prisma Client (done automatically in build)
npm run prisma:generate
```

## 📝 License

MIT License

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📧 Support

For issues and questions:

- Open an issue on [GitHub](https://github.com/RustuKeten/AI-OCR-PDF-Extracter/issues)
- Check existing issues and documentation

## 🙏 Acknowledgments

- Built with [Next.js](https://nextjs.org/)
- Database powered by [Supabase](https://supabase.com/)
- AI powered by [OpenAI](https://openai.com/)
- Icons by [Lucide](https://lucide.dev/)

---

**Made with ❤️ by [RustuKeten](https://github.com/RustuKeten)**
