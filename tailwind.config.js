/** @type {import('tailwindcss').Config} */
module.exports = {
  // Configure files to scan for Tailwind classes
  content: [
    "./src/**/*.{html,js}", // Look for Tailwind classes in all HTML and JS files within the src directory
  ],
  theme: {
    extend: {
      // Customizations for your design system can go here.
      // For example, adding custom colors, fonts, spacing, etc.
      // We're using 'Inter' font via CDN, so no need to extend fonts here for now.
    },
  },
  plugins: [],
}
