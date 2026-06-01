

1. Install dependencies:
   `npm install`
2. Create a `.env.local` file in the project root with your AWS credentials and app settings.

   Example `.env.local` contents:
   ```env
   AWS_ACCESS_KEY_ID=your-access-key-id
   AWS_SECRET_ACCESS_KEY=your-secret-access-key
   AWS_REGION=eu-north-1
   AWS_TEXTRACT_REGION=eu-central-1
   AWS_S3_BUCKET=tasmia-textract-files
   AWS_S3_BUCKET_REGION=eu-north-1
   DATABASE_URL=postgresql://...
   JWT_SECRET=your-jwt-secret
   GROQ_API_KEY=your-groq-api-key
   GEMINI_API_KEY=your-gemini-api-key
   ```
3. Run the app:
   `npm run dev`
