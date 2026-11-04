import {initializeApp,getAuth,getFunctions,httpsCallable,browserSessionPersistence,setPersistence} from './firebase-sdk.js';
export const firebaseConfig = {
 apiKey:'AIzaSyCJF4fEP_ZtacRPX5LklTp_Gu3xcQNV4ao',
 authDomain:'bertantasman-yeniparti.firebaseapp.com',
 projectId:'bertantasman-yeniparti',
 storageBucket:'bertantasman-yeniparti.firebasestorage.app',
 messagingSenderId:'286519317682',
 appId:'1:286519317682:web:b440e6e9694438e5ace5ab',
 measurementId:'G-QH88FHM93H'
};
const app=initializeApp(firebaseConfig);
export const auth=getAuth(app);
export const authReady=setPersistence(auth,browserSessionPersistence);
const invoke=httpsCallable(getFunctions(app,'us-central1'),'webAdminUsers',{timeout:60000});
export async function manageUsers(data){return (await invoke(data)).data;}
// Analytics is intentionally not initialized for this administration interface.
