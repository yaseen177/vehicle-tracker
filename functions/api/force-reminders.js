// functions/api/force-reminders.js
import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, doc, updateDoc } from "firebase/firestore";

export async function onRequest(context) {
  const { env } = context;

  // 1. Setup Firebase (Same as your app)
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

  const logs = []; // We will print this to the screen so you can see what happened

  try {
    // 2. Fetch all users
    const usersSnap = await getDocs(collection(db, "users"));
    
    for (const userDoc of usersSnap.docs) {
      const userData = userDoc.data();
      if (!userData.phoneNumber || !userData.smsEnabled) continue;

      // 3. Fetch vehicles for this user
      const vehiclesSnap = await getDocs(collection(db, "users", userDoc.id, "vehicles"));
      
      for (const vehicleDoc of vehiclesSnap.docs) {
        const vehicle = vehicleDoc.data();
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()); // Midnight today

        // Check Logic
        await checkDate(vehicle, userData, 'MOT', vehicle.motExpiry, today, env, logs);
        await checkDate(vehicle, userData, 'Tax', vehicle.taxExpiry, today, env, logs);
        await checkDate(vehicle, userData, 'Insurance', vehicle.insuranceExpiry, today, env, logs);
      }
    }

    return new Response(JSON.stringify({ status: "Run Complete", logs }, null, 2), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message, stack: err.stack }), { status: 500 });
  }
}

// Helper Function
async function checkDate(vehicle, user, type, dateStr, today, env, logs) {
  if (!dateStr) return;
  
  const expiryDate = new Date(dateStr);
  const diffTime = expiryDate - today;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 

  logs.push(`Checking ${vehicle.registration} ${type}: ${diffDays} days left`);

  if (diffDays === 7 || diffDays === 14) {
    logs.push(`!!! TRIGGERING SMS for ${vehicle.registration} (${type})`);
    
    // SEND SMS via Twilio
    const message = `Reminder: ${type} for ${vehicle.registration} expires in ${diffDays} days (${dateStr}).`;
    
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`;
    const auth = btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`);
    
    const body = new URLSearchParams();
    body.append("To", user.phoneNumber);
    body.append("From", env.TWILIO_PHONE_NUMBER);
    body.append("Body", message);

    const res = await fetch(twilioUrl, {
      method: "POST",
      headers: { 
        "Authorization": `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: body
    });
    
    if (!res.ok) {
        const errText = await res.text();
        logs.push(`Twilio Error: ${errText}`);
    } else {
        logs.push(`SMS Sent successfully to ${user.phoneNumber}`);
    }
  }
}