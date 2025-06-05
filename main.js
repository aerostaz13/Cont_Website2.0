// main.js

let produits = [];    // Array d'objets produits (Référence, Nom, Poids_unité, Volume_unité, Refrigerer, ...)
let conteneurs = [];  // Array d'objets conteneurs ("NAME ", "ID ", Poids_max, Capacite_plus_de_quatre, Capacite_quatre_ou_moins, ...)

/**
 * Au chargement de la page :
 *   → on récupère produits.json et conteneurs.json,
 *   → on génère le tableau des produits,
 *   → on branche le click du bouton “Calculer”.
 */
window.addEventListener("DOMContentLoaded", async () => {
  try {
    const [respP, respC] = await Promise.all([
      fetch("produits.json"),
      fetch("conteneurs.json")
    ]);
    if (!respP.ok || !respC.ok) {
      throw new Error("Impossible de charger les fichiers JSON.");
    }
    produits = await respP.json();
    conteneurs = await respC.json();

    genererTableProduits();
    document.getElementById("btn-calculer")
            .addEventListener("click", traiterCalcul);
  } catch (err) {
    alert("Erreur au chargement des données : " + err.message);
    console.error(err);
  }
});

/**
 * Remplit dynamiquement le <tbody> du tableau produits avec toutes les lignes,
 * incluant le champ “Quantité” et l’indication “Réfrigéré ?”.
 */
function genererTableProduits() {
  const tbody = document.querySelector("#table-produits tbody");
  tbody.innerHTML = "";

  produits.forEach((prod, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${prod["Référence"]}</td>
      <td>${prod["Nom"] || ""}</td>
      <td>${parseFloat(prod["Poids_unité"]).toLocaleString("fr-FR", { minimumFractionDigits: 3 })}</td>
      <td>${parseFloat(prod["Volume_unité"]).toLocaleString("fr-FR", { minimumFractionDigits: 6 })}</td>
      <td style="text-align: center;">${prod["Refrigerer"] == 1 ? "✅" : "—"}</td>
      <td>
        <input
          type="number"
          id="quantite-${i}"
          min="0"
          step="1"
          value="0"
          style="width: 60px;"
        />
      </td>
    `;
    tbody.appendChild(tr);
  });
}

/**
 * Quand l’utilisateur clique sur “Calculer”, on :
 *  1) Calcule totalVolAll, totalPdsAll (tous produits confondus)
 *     et on détermine hasRefrig = true si au moins un produit est réfrigéré.
 *  2) Si (totalVolAll + totalPdsAll === 0) → “Aucune quantité saisie.” et on quitte.
 *  3) Filtrer la liste de conteneurs selon hasRefrig :
 *       • s’il y a un produit réfrigéré → ne garder que TC20R, TC40R, TC40HCR
 *       • sinon → ne garder que tous les autres (non-R)
 *  4) Appeler findOptimalContainers(totalVolAll, totalPdsAll, available)
 *     pour calculer le(s) conteneur(s) optimal(aux) pour **l’ensemble** de la commande.
 *  5) Afficher un seul bloc de résultat avec le titre adapté (+infos).
 */
function traiterCalcul() {
  // 1. Calculer les totaux pour tous les produits et vérifier présence de réfrigéré
  let totalPdsAll = 0;
  let totalVolAll = 0;
  let hasRefrig   = false;

  produits.forEach((prod, i) => {
    const qt = parseInt(document.getElementById(`quantite-${i}`).value, 10) || 0;
    if (qt <= 0) return;
    const poidsUn = parseFloat(prod["Poids_unité"]);
    const volUn   = parseFloat(prod["Volume_unité"]);
    totalPdsAll += qt * poidsUn;
    totalVolAll += qt * volUn;
    if (prod["Refrigerer"] == 1) {
      hasRefrig = true;
    }
  });

  // 2. Si aucune quantité saisie
  if (totalVolAll === 0 && totalPdsAll === 0) {
    afficherMessage({
      html: `<div class="message"><em>Aucune quantité saisie.</em></div>`
    });
    return;
  }

  // 3. Filtrer la liste des conteneurs selon hasRefrig
  let available;
  let categorie;
  if (hasRefrig) {
    // Tous les produits (réfrigérés + non réfrigérés) vont dans un container réfrigéré
    available = conteneurs.filter(c => {
      const code = (c["NAME "] || "").trim();
      return code === "TC20R" || code === "TC40R" || code === "TC40HCR";
    });
    categorie = "Commande contenant au moins un produit réfrigéré";
  } else {
    // Aucun produit réfrigéré : on peut utiliser les conteneurs secs
    available = conteneurs.filter(c => {
      const code = (c["NAME "] || "").trim();
      return code !== "TC20R" && code !== "TC40R" && code !== "TC40HCR";
    });
    categorie = "Produits non réfrigérés uniquement";
  }

  // 4. Calcul du( des) conteneur(s) optimaux pour TOTAL vol+poids (toute la commande)
  const resultat = findOptimalContainers(totalVolAll, totalPdsAll, available);

  // 5. Format du message et affichage
  const messageHTML = formatResultMessage(
    categorie,
    totalVolAll,
    totalPdsAll,
    resultat
  );
  afficherMessage({ html: messageHTML });
}

/**
 * findOptimalContainers(totalVol, totalPds, availableContainers):
 *   - totalVol, totalPds = besoins totaux à couvrir.
 *   - availableContainers = array d’objets conteneur
 *     (chacun contenant "NAME ", "Poids_max", "Capacite_plus_de_quatre", ...).
 *
 * Algorithme :
 *   1. On construit `list` = [{ code, volCap, pdsCap }, …] trié par volCap croissant (puis pdsCap).
 *   2. On cherche un **conteneur unique** qui couvre (totalVol, totalPds),
 *      en minimisant d’abord le gaspillage de VOLUME (volCap−totalVol),
 *      puis, s’ils sont à égalité, le gaspillage de POIDS (pdsCap−totalPds).
 *      → Si on en trouve un, on renvoie { containers: [code], capVolume, capPoids, resteVolume, restePoids }.
 *   3. Sinon, on teste **toutes les paires** (i ≤ j) de conteneurs dans `list`,
 *      on calcule (volCap1+volCap2, pdsCap1+pdsCap2), on ne garde que celles qui couvrent,
 *      et on retient la paire qui minimise d’abord (volSum−totalVol) puis (pdsSum−totalPds).
 *      → Si on trouve une paire, on renvoie { containers: [code1, code2], ... }.
 *   4. Si aucune paire ne suffit, on prend N exemplaires du plus grand conteneur (dernier de `list`)
 *      pour couvrir à la fois volume et poids :
 *        nbByVol = ceil(totalVol / largest.volCap)
 *        nbByPds = ceil(totalPds / largest.pdsCap)
 *        nbNeeded = max(nbByVol, nbByPds)
 *      → On renvoie { containers: Array(nbNeeded).fill(largest.code), ... }.
 *   5. Si `list.length === 0` (aucun conteneur dispo), on renvoie un objet à clé `error`.
 *
 * Le résultat final est un objet :
 *   {
 *     containers:   [ "CODE1", "CODE2", … ], // codes des conteneurs choisis
 *     capVolume:    xxx,                     // somme des volCap utilisés
 *     capPoids:     yyy,                     // somme des pdsCap utilisés
 *     resteVolume:  capVolume − totalVol,
 *     restePoids:   capPoids − totalPds,
 *     error?        "message"                // si aucune solution possible
 *   }
 */
function findOptimalContainers(totalVol, totalPds, availableContainers) {
  // 1. Transformer en [{code, volCap, pdsCap}, …] et trier par volCap asc, puis pdsCap
  const list = availableContainers
    .map(c => ({
      code:   (c["NAME "] || "").trim(),
      volCap: parseFloat(c["Capacite_plus_de_quatre"]),
      pdsCap: parseFloat(c["Poids_max"])
    }))
    .filter(c => c.code && !isNaN(c.volCap) && !isNaN(c.pdsCap))
    .sort((a, b) => {
      if (a.volCap !== b.volCap) return a.volCap - b.volCap;
      return a.pdsCap - b.pdsCap;
    });

  // 2. Conteneur UNIQUE, on minimise d’abord wasteVol, puis wastePds
  let meilleurMono = null;
  for (let c of list) {
    if (c.volCap >= totalVol && c.pdsCap >= totalPds) {
      const wasteVol = c.volCap - totalVol;
      const wastePds = c.pdsCap - totalPds;
      if (
        !meilleurMono ||
        wasteVol < meilleurMono.wasteVol ||
        (wasteVol === meilleurMono.wasteVol && wastePds < meilleurMono.wastePds)
      ) {
        meilleurMono = { container: c, wasteVol, wastePds };
      }
    }
  }
  if (meilleurMono) {
    const c = meilleurMono.container;
    return {
      containers:  [c.code],
      capVolume:   c.volCap,
      capPoids:    c.pdsCap,
      resteVolume: parseFloat((c.volCap - totalVol).toFixed(6)),
      restePoids:  parseFloat((c.pdsCap - totalPds).toFixed(3))
    };
  }

  // 3. Tester toutes les PAIRES (i ≤ j), minimiser wasteVol puis wastePds
  let meilleurPair = null;
  for (let i = 0; i < list.length; i++) {
    for (let j = i; j < list.length; j++) {
      const c1 = list[i];
      const c2 = list[j];
      const volSum = c1.volCap + c2.volCap;
      const pdsSum = c1.pdsCap + c2.pdsCap;
      if (volSum >= totalVol && pdsSum >= totalPds) {
        const wasteVol = volSum - totalVol;
        const wastePds = pdsSum - totalPds;
        if (
          !meilleurPair ||
          wasteVol < meilleurPair.wasteVol ||
          (wasteVol === meilleurPair.wasteVol && wastePds < meilleurPair.wastePds)
        ) {
          meilleurPair = { pair: [c1, c2], wasteVol, wastePds };
        }
      }
    }
  }
  if (meilleurPair) {
    const [c1, c2] = meilleurPair.pair;
    return {
      containers:  [c1.code, c2.code],
      capVolume:   c1.volCap + c2.volCap,
      capPoids:    c1.pdsCap + c2.pdsCap,
      resteVolume: parseFloat(((c1.volCap + c2.volCap) - totalVol).toFixed(6)),
      restePoids:  parseFloat(((c1.pdsCap + c2.pdsCap) - totalPds).toFixed(3))
    };
  }

  // 4. Si pas de monocon­tainer ni de paire, prendre N exemplaires du plus grand conteneur
  if (list.length === 0) {
    return {
      containers:   [],
      capVolume:    0,
      capPoids:     0,
      resteVolume:  0,
      restePoids:   0,
      error:        "Aucun conteneur disponible dans cette catégorie."
    };
  }
  const largest = list[list.length - 1];
  const nbByVol = Math.ceil(totalVol  / largest.volCap);
  const nbByPds = Math.ceil(totalPds / largest.pdsCap);
  const nbNeeded = Math.max(nbByVol, nbByPds);

  const totalCapVol = largest.volCap * nbNeeded;
  const totalCapPds = largest.pdsCap * nbNeeded;
  return {
    containers:   Array(nbNeeded).fill(largest.code),
    capVolume:    totalCapVol,
    capPoids:     totalCapPds,
    resteVolume:  parseFloat((totalCapVol - totalVol).toFixed(6)),
    restePoids:   parseFloat((totalCapPds - totalPds).toFixed(3))
  };
}

/**
 * formatResultMessage(titreCat, totalVol, totalPds, resultat)
 *   Construit le bloc HTML pour une catégorie unique (soit réfrigéré, soit sec),
 *   selon titreCat, totalVol, totalPds, et l’objet résultat de findOptimalContainers.
 */
function formatResultMessage(titreCat, totalVol, totalPds, resultat) {
  let html = `<div class="message categorie">`;
  html += `<div class="message-item titre">${titreCat} :</div>`;

  if (resultat.error) {
    html += `<div class="message-item">⚠️ ${resultat.error}</div>`;
  } else {
    const codes = resultat.containers.join(" + ");
    html += `<div class="message-item">📦 Conteneur(s) sélectionné(s) : <strong>${codes}</strong></div>`;
    html += `<div class="message-item">🔍 Capacité totale : <strong>${resultat.capVolume.toLocaleString("fr-FR", { minimumFractionDigits: 6 })} m³</strong> et <strong>${resultat.capPoids.toLocaleString("fr-FR", { minimumFractionDigits: 3 })} kg</strong></div>`;
    html += `<div class="message-item">⚖️ Besoins totaux : <strong>${totalVol.toLocaleString("fr-FR", { minimumFractionDigits: 6 })} m³</strong> et <strong>${totalPds.toLocaleString("fr-FR", { minimumFractionDigits: 3 })} kg</strong></div>`;
    html += `<div class="message-item">✅ Espace restant : <strong>${resultat.resteVolume.toLocaleString("fr-FR", { minimumFractionDigits: 6 })} m³</strong> et <strong>${resultat.restePoids.toLocaleString("fr-FR", { minimumFractionDigits: 3 })} kg</strong></div>`;
  }

  html += `</div>`;
  return html;
}

/**
 * Injecte le HTML dans la div #message-resultat.
 */
function afficherMessage({ html }) {
  const zone = document.getElementById("message-resultat");
  zone.innerHTML = html;
}

