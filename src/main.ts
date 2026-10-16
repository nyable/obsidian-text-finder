// Obsidian requires the plugin class as its CommonJS default export.
// All concrete host services are assembled in app, never inside feature UI.
export { default } from "./app/create-plugin-runtime";
