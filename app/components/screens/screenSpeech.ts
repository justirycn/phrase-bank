import { BrowserSpeechService } from "../../services/speech";
import { NaturalSpeechService } from "../../services/naturalSpeech";

export const screenSpeech = new NaturalSpeechService(new BrowserSpeechService());

if (typeof window !== "undefined") window.addEventListener("phrase-account-closed", () => screenSpeech.dispose());
