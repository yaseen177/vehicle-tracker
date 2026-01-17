import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

// --- PASTE YOUR FIREBASE CONFIG HERE ---
// Go to Firebase Console -> Project Settings -> General -> Your Apps
const firebaseConfig = {
    apiKey: "AIzaSyAP_dil3q6wjHayLcMvz2Ig9IuDFiof2vI",
    authDomain: "caradminproject.firebaseapp.com",
    projectId: "caradminproject",
    storageBucket: "caradminproject.firebasestorage.app",
    messagingSenderId: "712671113973",
    appId: "1:712671113973:web:2359882a0c2c9c92288bbc",
    measurementId: "G-FBW8E81TK0"
};
// ---------------------------------------

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app);
export const storage = getStorage(app);