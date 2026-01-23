// functions/api/force-reminders.js
import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs } from "firebase/firestore";
// 1. CHANGED IMPORTS: We need 'initializeAuth' and 'inMemoryPersistence'
import { initializeAuth, inMemoryPersistence, signInWithEmailAndPassword } from "firebase/auth";

export async function onRequest(context) {
  const { env } = context;

  // Setup Config
  const firebaseConfig = {
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: env.VITE_FIREBASE_APP_ID,
  };

  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);

  // 2. THE FIX: Force Auth to use Memory Only (No LocalStorage)
  const auth = initializeAuth(app, {
    persistence: inMemoryPersistence
  });

  const logs = [];

  try {
    // 3. Sign In
    logs.push("Attempting to sign in as Worker...");
    await signInWithEmailAndPassword(auth, env.WORKER_EMAIL, env.WORKER_PASSWORD);
    logs.push("Worker signed in successfully.");

    // 4. Run the Checks
    const usersSnap = await getDocs(collection(db, "users"));
    logs.push(`Found ${usersSnap.size} users.`);
    
    for (const userDoc of usersSnap.docs) {
      const userData = userDoc.data();
      // Skip users without phone numbers or sms enabled
      if (!userData.phoneNumber || !userData.smsEnabled) continue;

      const vehiclesSnap = await getDocs(collection(db, "users", userDoc.id, "vehicles"));
      
      for (const vehicleDoc of vehiclesSnap.docs) {
        const vehicle = vehicleDoc.data();
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()); 

        // Check All Dates
        await checkDate(vehicle, userData, 'MOT', vehicle.motExpiry, today, env, logs);
        await checkDate(vehicle, userData, 'Tax', vehicle.taxExpiry, today, env, logs);
        await checkDate(vehicle, userData, 'Insurance', vehicle.insuranceExpiry, today, env, logs);
      }
    }

    return new Response(JSON.stringify({ status: "Success", logs }, null, 2), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    // Return the full error so you can see it in the browser
    return new Response(JSON.stringify({ error: err.message, stack: err.stack }, null, 2), { status: 500 });
  }
}

// Helper Function (Same as before)
async function checkDate(vehicle, user, type, dateStr, today, env, logs) {
  if (!dateStr) return;
  
  const expiryDate = new Date(dateStr);
  const diffTime = expiryDate - today;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 

  // Log everything so we can see it working
  // logs.push(`Checked ${vehicle.registration} ${type}: ${diffDays} days`);

  if (diffDays === 7 || diffDays === 14) {
    logs.push(`!!! TRIGGERING SMS for ${vehicle.registration} (${type})`);
    
    const message = `Reminder: ${type} for ${vehicle.registration} expires in ${diffDays} days (${dateStr}).`;
    
    // Twilio Logic
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`;
    const authHeader = btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`);
    
    const body = new URLSearchParams();
    body.append("To", user.phoneNumber);
    body.append("From", env.TWILIO_PHONE_NUMBER);
    body.append("Body", message);

    const res = await fetch(twilioUrl, {
      method: "POST",
      headers: { 
        "Authorization": `Basic ${authHeader}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: body
    });
    
    if (!res.ok) {
        const errText = await res.text();
        logs.push(`Twilio Error: ${errText}`);
    } else {
        logs.push(`SMS Sent to ${user.phoneNumber}`);
    }
  }
}