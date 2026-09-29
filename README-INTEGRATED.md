# MediLink Professional Build

This version keeps one clean workflow across web and mobile:
- Staff login first
- Patient authentication second
- One supervised patient workspace after authentication
- The same in-app assistant is available in both web and mobile because the mobile app opens the shared web workspace inside WebView

## What was updated
- Added a reusable in-app chatbot with one backend assistant route and one shared front-end widget
- The assistant works in the web app and in the mobile app because both use the same web pages
- The login flow is enforced as staff login first, then patient authentication
- Direct public patient login is removed from the main workflow
- The mobile app now opens the staff login page instead of the old patient login page
- Kept the implementation lightweight so more medical features can be added later without hardcoding a fixed assistant flow

## Main files changed
- `server.js`
- `services/app-chatbot.js`
- `public/js/app-chatbot.js`
- `views/partials/footer.ejs`
- `views/partials/header.ejs`
- `views/login.ejs`
- `views/partials/patient-workspace.ejs`
- `views/patient-qr.ejs`
- `mobile-patient-app/App.js`
- `public/css/style.css`

## Website - step by step
1. Open **XAMPP Control Panel**.
2. Start **Apache** and **MySQL**.
3. Open the project folder `smart web-emergency-medical-system` in **VS Code**.
4. Check the `.env` file and confirm these values match your setup:
   - `DB_CLIENT=mysql`
   - `DB_HOST=localhost`
   - `DB_PORT=3306`
   - `DB_USER=root`
   - `DB_PASSWORD=`
   - `DB_NAME=smart_emergency_medical_system`
   - `PORT=3000`
5. Open a VS Code terminal in the web project folder.
6. Run:
   - `npm install`
   - `npm run check-db`
   - `npm start`
7. Open your browser at:
   - `http://localhost:3000`
8. Login flow:
   - Open **Staff Login**
   - Sign in with staff credentials
   - Go to **Patient Access**
   - Authenticate the patient
   - Open the patient record

## Mobile app - step by step
1. Make sure the web server is already running.
2. Open a second VS Code terminal.
3. Go to the mobile folder:
   - `cd mobile-patient-app`
4. Install dependencies:
   - `npm install`
5. Set the backend URL so Expo can load the web workspace:
   - create `.env` from `.env.example` if needed
   - set `EXPO_PUBLIC_API_URL` to your running web server URL
   - for local browser preview use something like `http://localhost:3000`
   - for a real phone use a reachable URL on your network or tunnel
6. Start Expo:
   - `npm start`
7. Open the app:
   - press `w` for web preview, or
   - scan the Expo QR code with Expo Go
8. The mobile app will open the same MediLink login flow:
   - Staff login first
   - Patient authentication second
   - Patient record and chatbot after authentication

## Assistant behavior
- Explains the current page and workflow
- Summarizes the currently authenticated patient record when data is available
- Adapts to available patient-related data instead of assuming fixed medical modules
- Uses the existing full-stack session and patient context

## Important routes
- `/login` → staff login
- `/patient-access` → patient authentication after staff login
- `/patient-portal/:patientCode` → supervised patient workspace
- `/dashboard` → staff dashboard
- `/emergency-dashboard` → emergency workflows

## Demo staff credentials
- Doctor: `doctor@hospital.com` / `DrA#4821pQ`
- Nurse: `nurse@hospital.com` / `NrL#5731xM`
- Admin: `admin@hospital.com` / `AdM#9042qW`
