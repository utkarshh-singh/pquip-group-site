# PQuIP Group Website

Welcome to the official repository for the PQuIP Group website. This repository contains the source code for our research group's GitHub Pages site, hosted at `https://utkarshh-singh.github.io/pquip-group-site/`.

## Repository Structure

```
├── index.html          # Homepage
├── publications.html   # Group Publications
├── member.html         # Members
├── news.html           # Extras
├── join.html           # Join Us
├── people.html         # Team members page
├── research.html       # Research projects
├── contact.html        # Contact Us
├── assets/
│   ├── css/           # Stylesheets
│   ├── js/            # JavaScript files
│   └── img/           # Images and photos
    ```
├── tools/
│   ├──           
|   ```
├── data/
│   ├──           
|   ```
├── members/
│   ├──           
│   ```
└── README.md          # This file
```

## For Group Members: How to Edit Your Page

### Option 1: Edit Directly on GitHub (Recommended for beginners)

1. **Navigate to the file you want to edit** (usually `page.html` for member profiles)
2. **Click the pencil icon** (✏️) to edit the file
3. **Make your changes** using the web editor
4. **Scroll down to "Commit changes"**
5. **Add a brief description** of what you changed (e.g., "Updated Zahra's bio")
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
- Edit `members/[your first name]/page.html` to update your personal page
- Update your photos in `assets/img/` or `assets/img/`
- Include: name, title, bio, contact info, research interests, etc. at 'members/[your first name]/profile.json'

### Creating Your Member Page (New Members)
1. **Create your folder:** Make a new folder under `members/` with your name (e.g., `members/tamal/`)
2. **Add your page:** Create an `page.html` file in your folder
3. **Add assets:** Upload your image to `assets/img/` subfolder
4. **Link from main page:** Update `manifest.json` to link to your new page (e.g., `["khabat","aaron","anaelle","milica","utkarsh","valerio","arezoo","tamal","zahra"]`)

### Adding Publications
- Add your "semanticScholarId" to 'members/[your first name]/profile.json'

### Updating Photos
- Upload new images to `assets/img/`
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
