# PQuIP Group Website

Welcome to the official repository for the PQuIP Group website. This repository contains the source code for our research group's GitHub Pages site, hosted at `https://utkarshh-singh.github.io/pquip-group-site/`.

## Repository Structure

```
├── index.html          # Homepage
├── people.html         # Team members page
├── research.html       # Research projects and publications
├── assets/
│   ├── css/           # Stylesheets
│   ├── js/            # JavaScript files
│   └── img/           # Images and photos
└── README.md          # This file
```

## For Group Members: How to Edit Your Page

### Option 1: Edit Directly on GitHub (Recommended for beginners)

1. **Navigate to the file you want to edit** (usually `people.html` for member profiles)
2. **Click the pencil icon** (✏️) to edit the file
3. **Make your changes** using the web editor
4. **Scroll down to "Commit changes"**
5. **Add a brief description** of what you changed (e.g., "Updated John's bio")
6. **Click "Commit changes"** to save

### Option 2: Clone and Edit Locally

1. **Clone the repository:**
   ```bash
   git clone https://github.com/utkarshh-singh/pquip-group-site.git
   cd pquip-group-site
   ```

2. **Make your changes** using your preferred text editor

3. **Commit and push your changes:**
   ```bash
   git add .
   git commit -m "Description of your changes"
   git push origin main
   ```

## Common Editing Tasks

### Adding/Updating Your Profile
- Edit `people.html` to update the main team page
- Edit your personal page in `members/[your-name]/index.html`
- Update your photos in `members/[your-name]/assets/` or `assets/img/people/`
- Include: name, title, bio, contact info, research interests

### Creating Your Member Page (New Members)
1. **Create your folder:** Make a new folder under `members/` with your name (e.g., `members/john-doe/`)
2. **Add your page:** Create an `index.html` file in your folder
3. **Add assets:** Create an `assets/` subfolder for your images and files
4. **Link from main page:** Update `people.html` to link to your new page

### Adding Publications
- Edit `research.html` or the relevant research page
- Follow the existing format for consistency

### Updating Photos
- Upload new images to `assets/img/` (for general site images)
- Upload member-specific images to `members/[your-name]/assets/`
- Use web-optimized formats (JPG, PNG, WebP)
- Keep file sizes reasonable (<1MB for photos)

## Guidelines

- **Test your changes:** The site updates automatically, but double-check that everything looks correct
- **Follow the existing style:** Keep formatting consistent with the rest of the site
- **Use descriptive commit messages:** Help others understand what you changed
- **Ask for help:** If you're unsure about something, create an issue or ask another member

## Technical Notes

- This site uses GitHub Pages for hosting
- Changes to the `main` branch are automatically deployed
- The site typically updates within a few minutes of committing changes

## Need Help?

- **GitHub editing help:** Check GitHub's documentation on editing files
- **HTML/CSS questions:** Ask technical members or create an issue
- **Site not updating:** Wait a few minutes, then check the Actions tab for build status

---

© 2025 PQuIP Group
