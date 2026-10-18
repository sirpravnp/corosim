/**
 * The baked anatomy shipped with the site. Average four-chamber heart of a statistical shape model of healthy adult CT hearts:
 * Rodero C, Strocchi M, Marciniak M, et al., PLoS Comput Biol 17(4): e1008851 (2021), CC BY 4.0, Zenodo 10.5281/zenodo.4593739.
 * Show this credit wherever the heart is shown.
 */
import { loadHeart, type Heart, type HeartMeta } from "./volume";
import heartJson from "../data/heart.json";

export const HEART_CREDIT = "Anatomy: Rodero et al. 2021, PLoS Comput Biol 17(4):e1008851, average shape of a healthy adult four-chamber heart (CC BY 4.0, Zenodo 10.5281/zenodo.4593739). Not a patient.";

export const heartMeta = heartJson as unknown as HeartMeta;
/** Vite turns this into the hashed asset URL. */
export const heartUrl = new URL("../data/heart.bin.gz", import.meta.url).href;

let cached: Promise<Heart> | null = null;
/** Fetch and decode the shipped volume once. */
export const loadBakedHeart = () => (cached ??= loadHeart(heartUrl, heartMeta));
