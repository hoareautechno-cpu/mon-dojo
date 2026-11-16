# Mon Dojo 🥋

Ton outil perso pour organiser le **ménage**, la **santé**, le **sport** et le **bien-être mental**. Pensé pour le téléphone, 5 minutes par jour, style manga.

👉 **Appli : https://hoareautechno-cpu.github.io/mon-dojo/**

## Ce que fait la V1

- **Ma journée** : 3 priorités maximum, « vider ma tête », check-in (humeur, sommeil, poids, une gratitude), ménage du jour, séance de sport, respiration guidée.
- **Envie de sucre** : bouton « J'ai une envie » avec minuteur de 15 minutes, conseils, ton plan « si… alors… » pour ce déclencheur, et un message bienveillant si tu craques.
- **Ma semaine** : les 7 prochains jours (ménage prévu, séances, priorités) pour anticiper, et « Qui fait quoi » (temps prévu par personne).
- **Délégation (V1.1)** : chaque tâche a un responsable (toi, Maman, l’Ado, la Petite… modifiable dans Dojo → Le foyer). Bouton « Déléguer » (juste aujourd’hui ou à chaque fois), tâches ponctuelles, « 1 semaine sur 2 », bouton « Envoyer » qui prépare un message WhatsApp ou SMS avec les tâches du jour de la personne, et le planning familial prêt à charger.
- **Tableau de bord** : courbes poids, humeur, sommeil ; envies surfées, séances et ménage par semaine ; déclencheurs les plus fréquents.
- **Motivation** : XP, niveaux (Apprenti → Légende), 21 badges, et un **bilan hebdo automatique** chaque lundi. Pas de série à ne jamais casser.

## Nouveautés de la V2

- **Argent** (nouvel onglet) : dépense notée en 10 secondes (montant, catégorie, note, paiement), totaux du jour, de la semaine et du mois, comparaison avec le mois précédent, budgets par catégorie (vert, orange à 80 %, rouge), dépenses fixes proposées chaque mois à confirmer, liste « en attente 48 h » contre les achats impulsifs, épargne de précaution, export CSV.
- **Projets perso** : projets découpés en petites actions ; la prochaine action s'affiche dans Ma journée.
- **Famille** : 15 minutes rien qu'à chaque enfant, point couple hebdo, sortie à deux chaque mois.
- **Stats et bilan** : dépenses par semaine, snacks et sucreries comparés aux envies, argent dans le bilan hebdo, 7 nouveaux badges.
- **Réglages** : choisis les modules affichés dans Ma journée.

## Installer sur le téléphone

1. Ouvre le lien de l'appli dans Chrome (Android) ou Safari (iPhone).
2. Android : menu ⋮ → « Ajouter à l'écran d'accueil ». iPhone : bouton Partager → « Sur l'écran d'accueil ».
3. Crée ton mot de passe au premier lancement.

## Tes données

- Elles restent **sur ton téléphone**, chiffrées (AES-256) avec ton mot de passe. Rien n'est envoyé sur GitHub ni ailleurs.
- **Mot de passe oublié = données perdues.** Note-le dans un endroit sûr.
- Fais une sauvegarde chaque semaine : onglet **Dojo → Sauvegarde → Exporter** (fichier chiffré, à garder dans Drive par exemple).
- L'appli se verrouille toute seule après 10 minutes en arrière-plan.

## Rappels (notifications gratuites)

1. Installe l'appli **ntfy** (Play Store ou App Store).
2. Appuie sur **+** et abonne-toi au canal : `mondojo-uzh0p60ffw`
3. Tu recevras : 7 h 30 (priorités), 12 h 30 (déjeuner), 20 h 30 (check-in du soir), dimanche 18 h (préparer la semaine), lundi 7 h (bilan).

Pour tester tout de suite : onglet **Actions** du dépôt → « Rappels » → **Run workflow**.
Pour changer les horaires : modifie `.github/workflows/rappels.yml` (heures en UTC, La Réunion = UTC+4).
Bon à savoir : GitHub met en pause les tâches planifiées d'un dépôt sans aucune modification pendant 60 jours ; il suffit alors de cliquer « Enable workflow » dans l'onglet Actions.

## Technique

HTML, CSS et JavaScript simples, sans dépendance ni serveur. Hébergé gratuitement par GitHub Pages (branche `main`, dossier racine). Fonctionne hors ligne une fois chargé (service worker).

## Prochaines versions

- V1.1 : ajustements après une semaine d'usage.
- V2 : finances (saisie manuelle), travail perso, famille et couple, repas et courses, synchronisation entre appareils et comptes multiples.
