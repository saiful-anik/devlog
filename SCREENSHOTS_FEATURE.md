# Project Screenshots Feature

## Overview

You can now upload screenshots for your projects. Screenshots will be displayed:
1. **In Project Details** - In a dedicated Screenshots section
2. **In Timeline** - As special "Screenshot" events with unique styling

## How to Use

### Uploading Screenshots

1. Go to any project detail page
2. Click the **"Upload Screenshot"** button next to the "Add Task" button
3. Choose your screenshot using one of these options:
   - **📋 Paste from Clipboard** - Copy an image and paste it directly
   - **📁 Choose File** - Browse your computer for an image file
4. Add an optional caption describing the screenshot
5. Click **"Upload"** to save

### Viewing Screenshots

- **Project Detail Page**: Screenshots appear in the "Project Screenshots" section at the bottom of the page
- **Timeline**: Screenshots appear as entries with a special 🖼️ icon and a rose-colored badge

## Database Setup

The feature uses the existing `project_screenshots` table in Supabase:

```sql
CREATE TABLE project_screenshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  caption TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

## Components & Files

### New Files Created:

1. **`src/components/ScreenshotUploadDialog.tsx`**
   - Reusable dialog component for uploading screenshots
   - Handles clipboard image reading and file selection
   - Manages image upload to Supabase Storage and database

2. **`src/lib/db-helpers-screenshots.ts`**
   - Database helper functions for managing project screenshots
   - Functions: `getProjectScreenshots()`, `insertProjectScreenshot()`, `updateProjectScreenshot()`, `deleteProjectScreenshot()`

### Modified Files:

1. **`src/pages/ProjectDetail.tsx`**
   - Added import for `ScreenshotUploadDialog`
   - Added screenshot upload button next to "Add Task" button
   - Added screenshots section display area

2. **`src/pages/Timeline.tsx`**
   - Added screenshot fetching logic
   - Added "screenshot" event type to timeline
   - Added screenshot styling with Image icon and rose color

3. **`src/lib/store.ts`**
   - Added `ProjectScreenshot` interface
   - Updated `TimelineEvent` type to include "screenshot" type

## Features

✅ **Clipboard Support** - Paste screenshots directly from clipboard  
✅ **File Upload** - Browse and select image files  
✅ **Optional Captions** - Add descriptions to screenshots  
✅ **Storage** - Images stored in Supabase `devlog-images` bucket  
✅ **Timeline Integration** - View all screenshots chronologically  
✅ **Row-Level Security** - Users can only access their own screenshots  

## Image Size Limits

- Default max size: **2MB**
- Configurable via `getScreenshotSizeLimit()` in store

## Storage Location

Screenshots are stored in the `devlog-images` bucket under:
```
{user_id}/{project_id}/screenshot-{timestamp}.jpg
```

## Future Enhancements

- [ ] Screenshot editing/cropping before upload
- [ ] Bulk screenshot upload
- [ ] Screenshot galleries per project
- [ ] Screenshot sharing/comments
- [ ] Automatic screenshot comparison/versioning
