// main.js

let produits = [];    // Array d'objets { Référence, Nom, Poids_unité, Volume_unité, Refrigerer, ... }
let conteneurs = [];  // Array d'objets { "NAME ", "ID ", Poids_max, Capacite_plus_de_quatre, Capacite_quatre_ou_moins, ... }

/**
 * Au chargement de la page : on récupère les deux JSON puis on génère le tableau des produits.
 */
window.addEventListener("DOMContentLoaded", async () => {
  try {
    // 1. Charger produits.json et conteneurs.json depuis le même dossier
    const [respP, respC] = await Promise.all([
      fetch("produits.json"),
      fetch("conteneurs.json"),
    ]);
    if (!respP.ok || !respC.ok) {
      throw new Error("Impossible de charger les fichiers JSON.");
    }
    produits = await respP.json();
    conteneurs = await respC.json();

    // 2. Générer dynamiquement le tableau de produits
    genererTableProduits();
    // 3. Attacher l'événement sur le bouton “Calculer”
    document.getElementById("btn-calculer").addEventListener("click", traiterCalcul);
  } catch (err) {
    alert("Erreur au chargement des données : " + err.message);
    console.error(err);
  }
});

/**
 * Génère le <tbody> du tableau produits, en insérant une ligne par produit.
 */
function genererTableProduits() {
  const tbody = document.querySelector("#table-produits tbody");
  tbody.innerHTML = "";

  produits.forEach((prod, i) => {
    // Ex. prod = { "Product": "...", "Référence": "ALB25V_50", "Nom": "...", "Poids_unité": 0.0233, "Volume_unité": 0.000094, "Refrigerer": 0, ... }
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${prod["Référence"]}</td>
      <td>${prod["Nom"] || ""}</td>
      <td>${parseFloat(prod["Poids_unité"]).toLocaleString("fr-FR", { minimumFractionDigits: 3 })}</td>
      <td>${parseFloat(prod["Volume_unité"]).toLocaleString("fr-FR", { minimumFractionDigits: 6 })}</td>
      <td style="text-align: center;">${prod["Refrigerer"] == 1 ? "✅" : "—"}</td>
      <td><input type="number" id="quantite-${i}" min="0" step="1" value="0" style="width: 60px;"></td>
    `;
    tbody.appendChild(tr);
  });
}

/**
 * Fonction principale appelée au clic sur “Calculer”.
 * Elle :
 *  1. Parcourt toutes les quantités saisies et classe produits réfrigérés vs non réfrigérés.
 *  2. Calcule, pour chaque catégorie, le total volume + poids.
 *  3. Appelle findOptimalContainers(...) pour obtenir la ou les références de conteneurs optimaux.
 *  4. Affiche le résultat dans #message-resultat.
 */
function traiterCalcul() {
  // 1. Regrouper les totaux réfrigérés et non réfrigérés
  let totalRefPds = 0, totalRefVol = 0;
  let totalDryPds = 0, totalDryVol = 0;

  produits.forEach((prod, i) => {
    const qt = parseInt(document.getElementById(`quantite-${i}`).value, 10) || 0;
    if (qt <= 0) return;
    const poidsUn = parseFloat(prod["Poids_unité"]);
    const volUn = parseFloat(prod["Volume_unité"]);
    if (prod["Refrigerer"] == 1) {
      totalRefPds += qt * poidsUn;
      totalRefVol += qt * volUn;
    } else {
      totalDryPds += qt * poidsUn;
      totalDryVol += qt * volUn;
    }
  });

  // 2. Pour chaque catégorie, déterminer la/le meilleur(s) conteneur(s)
  const messages = [];
  if (totalRefVol > 0 || totalRefPds > 0) {
    // Appel pour conteneurs RÉFRIGÉRÉS
    const contRef = conteneurs.filter(c => {
      const code = (c["NAME "] || "").trim();
      return code === "TC20R" || code === "TC40R" || code === "TC40CHR";
    });
    const resultatRef = findOptimalContainers(totalRefVol, totalRefPds, contRef);
    messages.push(formatResultMessage("Produits réfrigérés", totalRefVol, totalRefPds, resultatRef));
  }

  if (totalDryVol > 0 || totalDryPds > 0) {
    // Appel pour conteneurs NON RÉFRIGÉRÉS
    const contDry = conteneurs.filter(c => {
      const code = (c["NAME "] || "").trim();
      // On exclut explicitement les codes R, on prend tout le reste
      return code !== "TC20R" && code !== "TC40R" && code !== "TC40CHR";
    });
    const resultatDry = findOptimalContainers(totalDryVol, totalDryPds, contDry);
    messages.push(formatResultMessage("Produits non réfrigérés", totalDryVol, totalDryPds, resultatDry));
  }

  if (messages.length === 0) {
    // Aucune quantité saisie
    afficherMessage({
      html: `<div class="message"><em>Aucune quantité saisie.</em></div>`
    });
  } else {
    afficherMessage({ html: messages.join("") });
  }
}

/**
 * Trouve la (ou les) référence(s) de conteneurs optimaux pour couvrir un besoin total (vol+poids).
 * availableContainers = array d’objets conteneur (avec c["NAME "], c["Poids_max"], c["Capacite_plus_de_quatre"])
 *
 * On tente d’abord un **conteneur unique** (le plus petit possible qui puisse contenir).
 * Si aucun ne suffit, on teste toutes les **paires** (y compris deux fois le même),
 * en choisissant la paire avec le gaspillage (somme(capacités) − besoin) minimal.
 * Si toujours insuffisant, on prend plusieurs exemplaires du plus grand conteneur jusqu’à couvrir le besoin.
 *
 * Retourne un objet { containers: [ array de codes ], capVolume: nb, capPoids: nb, resteVolume: nb, restePoids: nb }
 */
function findOptimalContainers(totalVol, totalPds, availableContainers) {
  // 1. Préparation : transformer availableContainers en tableau d’objets simples
  //    { code, volCap, pdsCap }
  const list = availableContainers.map(c => ({
    code: (c["NAME "] || "").trim(),
    volCap: parseFloat(c["Capacite_plus_de_quatre"]),
    pdsCap: parseFloat(c["Poids_max"])
  })).filter(c => c.code !== "" && !isNaN(c.volCap) && !isNaN(c.pdsCap));

  // On trie par volCap ascendant (puis pdsCap)
  list.sort((a, b) => {
    if (a.volCap !== b.volCap) return a.volCap - b.volCap;
    return a.pdsCap - b.pdsCap;
  });

  // 2. Cas : un **conteneur unique** suffit ?
  let meilleurMono = null;
  for (let c of list) {
    if (c.volCap >= totalVol && c.pdsCap >= totalPds) {
      const wasteVol = c.volCap - totalVol;
      const wastePds = c.pdsCap - totalPds;
      const waste = wasteVol + wastePds;
      if (!meilleurMono || waste < meilleurMono.waste) {
        meilleurMono = { container: c, waste, wasteVol, wastePds };
      }
    }
  }
  if (meilleurMono) {
    // On renvoie un résultat mono‐conteneur
    const c = meilleurMono.container;
    return {
      containers: [c.code],
      capVolume: c.volCap,
      capPoids: c.pdsCap,
      resteVolume: parseFloat((c.volCap - totalVol).toFixed(6)),
      restePoids: parseFloat((c.pdsCap - totalPds).toFixed(3))
    };
  }

  // 3. Sinon, on teste **toutes les paires** (peut inclure la même référence deux fois)
  let meilleurPair = null;
  for (let i = 0; i < list.length; i++) {
    for (let j = i; j < list.length; j++) {
      const c1 = list[i];
      const c2 = list[j];
      const capVolSum = c1.volCap + c2.volCap;
      const capPdsSum = c1.pdsCap + c2.pdsCap;
      if (capVolSum >= totalVol && capPdsSum >= totalPds) {
        const wasteVol = capVolSum - totalVol;
        const wastePds = capPdsSum - totalPds;
        const waste = wasteVol + wastePds;
        if (!meilleurPair || waste < meilleurPair.waste) {
          meilleurPair = {
            pair: [c1, c2],
            waste,
            wasteVol,
            wastePds
          };
        }
      }
    }
  }
  if (meilleurPair) {
    const [c1, c2] = meilleurPair.pair;
    return {
      containers: [c1.code, c2.code],
      capVolume: c1.volCap + c2.volCap,
      capPoids: c1.pdsCap + c2.pdsCap,
      resteVolume: parseFloat(((c1.volCap + c2.volCap) - totalVol).toFixed(6)),
      restePoids: parseFloat(((c1.pdsCap + c2.pdsCap) - totalPds).toFixed(3))
    };
  }

  // 4. Si on arrive ici, aucun combi en 1 ou 2 conteneurs ne suffit.  
  //    On va donc prendre **N** exemplaires du plus grand container (dernier de la liste triée).
  if (list.length === 0) {
    // Cas d’erreur : pas de conteneur disponible dans cette catégorie
    return {
      containers: [],
      capVolume: 0,
      capPoids: 0,
      resteVolume: 0,
      restePoids: 0,
      error: "Aucun conteneur disponible dans cette catégorie."
    };
  }
  const largest = list[list.length - 1];
  // On calcule le nombre minimum de ces conteneurs pour couvrir à la fois volume et poids :
  const nbByVol = Math.ceil(totalVol / largest.volCap);
  const nbByPds = Math.ceil(totalPds / largest.pdsCap);
  const nbNeeded = Math.max(nbByVol, nbByPds);

  const totalCapVol = largest.volCap * nbNeeded;
  const totalCapPds = largest.pdsCap * nbNeeded;
  return {
    containers: Array(nbNeeded).fill(largest.code),
    capVolume: totalCapVol,
    capPoids: totalCapPds,
    resteVolume: parseFloat((totalCapVol - totalVol).toFixed(6)),
    restePoids: parseFloat((totalCapPds - totalPds).toFixed(3))
  };
}

/**
 * Formate le bloc HTML pour une catégorie (“Produits réfrigérés” ou “Produits non réfrigérés”).
 *  - titreCat : string (“Produits réfrigérés” / “Produits non réfrigérés”)
 *  - totalVol / totalPds : nombres
 *  - resultat : l’objet renvoyé par findOptimalContainers(...)
 */
function formatResultMessage(titreCat, totalVol, totalPds, resultat) {
  let html = `<div class="message categorie">`;
  html += `<div class="message-item titre">${titreCat} :</div>`;

  if (resultat.error) {
    // Pas de conteneur dispo
    html += `<div class="message-item">⚠️ ${resultat.error}</div>`;
  } else {
    // On a trouvé un ou plusieurs conteneurs
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
 * Injecte le HTML généré dans #message-resultat
 */
function afficherMessage({ html }) {
  const zone = document.getElementById("message-resultat");
  zone.innerHTML = html;
}
