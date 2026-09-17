CREATE (:Customer {id: 'c1', email: 'ada@example.com', name: 'Ada Lovelace'});
CREATE (:Customer {id: 'c2', email: 'alan@example.com', name: 'Alan Turing'});
CREATE (:Product {sku: 'P-100', title: 'Notebook', legacyCode: 'NB-OLD-7', price: 4.5});
MATCH (c:Customer {id: 'c1'}), (p:Product {sku: 'P-100'})
CREATE (c)-[:PLACED]->(o:Purchase {ref: 'o-1', status: PurchaseStatus::placed, placedAt: localDateTime('2026-09-01T10:00:00')})-[:CONTAINS {quantity: 3}]->(p);
