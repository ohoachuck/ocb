# Estimation immobilière

Évaluer indicativement le prix d’un bien situé en France à partir de son adresse, de ses caractéristiques et des ventes récentes de sa commune, puis retrouver localement les résultats complets enregistrés.

![Capture](shots/1.jpg)

![Capture](shots/2.jpg)

![Capture](shots/3.jpg)

## Ce que cette app demande

- `share.present`

## Ce qu’elle peut contacter

Rien : cette app ne sort pas du téléphone.

## Service nécessaire

Cette app appelle un service qui **n’est pas fourni avec elle** :

- `io.github.OneNicolas/service-public`
- `io.github.cturkieh/france-data`

Sans ce service déclaré sur l’appareil, l’app s’installe et s’ouvre, mais
ce qui en dépend échoue. Elle le dit à l’écran.

## Ce que c’est

Une page HTML, une feuille de style, un script, exécutés localement sur le
téléphone. Pas de dépendance, pas d’outil de construction.

Publiée par Olivier HO-A-CHUCK (@ohoachuck). Relue par personne d’autre.

Sous licence MIT — voir `LICENSE`.
