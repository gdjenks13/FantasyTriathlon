// Public Supabase config for the browser app.
// The anon key is designed to be public; RLS + Auth protect writes.
// Copy your anon key from: Supabase Dashboard → Project Settings → API
// Optional override: create config.local.js (gitignored) with the same shape.
window.FANTASY_CONFIG = {
  supabaseUrl: "https://ayicngoasguoqegxoptd.supabase.co",
  // Paste anon public key here (or set via config.local.js)
  supabaseAnonKey:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF5aWNuZ29hc2d1b3FlZ3hvcHRkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ5MTI5MDUsImV4cCI6MjEwMDQ4ODkwNX0.1ioqAyT3azhUXlwCpTKN3umMjg7Nf2_8uPD7ncK_sao",
  // Optional: pre-fill login email for the editor account
  editorEmail: "ecjenks24@gmail.com",
  // Spectator poll interval (ms) as backup to Realtime
  pollIntervalMs: 5000,
};
