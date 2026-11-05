export const TRIVIA_TEMAS = ['cultura', 'ciencia', 'geografia', 'deportes', 'cine', 'historia', 'mexico', 'latinoamerica'] as const;

export type TriviaTema = (typeof TRIVIA_TEMAS)[number];

export interface TriviaQuestion {
  pregunta: string;
  opciones: [string, string, string, string];
  /** Índice (0-3) de la opción correcta. */
  correcta: number;
  explicacion: string;
  tema: TriviaTema;
}

function q(tema: TriviaTema, pregunta: string, opciones: [string, string, string, string], correcta: number, explicacion: string): TriviaQuestion {
  return { tema, pregunta, opciones, correcta, explicacion };
}

/** Banco local de respaldo cuando la IA está apagada o falla. */
export const TRIVIA_BANK: TriviaQuestion[] = [
  // Cultura general
  q('cultura', '¿Cuántos lados tiene un hexágono?', ['Cinco', 'Seis', 'Siete', 'Ocho'], 1, 'Hexa- significa seis en griego.'),
  q('cultura', '¿Quién escribió "Cien años de soledad"?', ['Mario Vargas Llosa', 'Julio Cortázar', 'Gabriel García Márquez', 'Pablo Neruda'], 2, 'La publicó en 1967 y fue clave para su Nobel de 1982.'),
  q('cultura', '¿Qué instrumento tiene 88 teclas?', ['Órgano', 'Acordeón', 'Clavecín', 'Piano'], 3, 'El piano moderno estándar tiene 52 teclas blancas y 36 negras.'),
  q('cultura', '¿Cuál es el idioma con más hablantes nativos del mundo?', ['Inglés', 'Español', 'Hindi', 'Chino mandarín'], 3, 'El mandarín supera los 900 millones de hablantes nativos.'),
  q('cultura', '¿Qué pintor es autor de "La noche estrellada"?', ['Vincent van Gogh', 'Claude Monet', 'Pablo Picasso', 'Salvador Dalí'], 0, 'La pintó en 1889 desde el asilo de Saint-Rémy.'),
  q('cultura', '¿Cuántos jugadores tiene un equipo de voleibol en cancha?', ['Cinco', 'Seis', 'Siete', 'Nueve'], 1, 'Seis por equipo, tres adelante y tres atrás.'),
  q('cultura', '¿Quién compuso "Las cuatro estaciones"?', ['Bach', 'Mozart', 'Vivaldi', 'Beethoven'], 2, 'Antonio Vivaldi las compuso alrededor de 1720.'),
  q('cultura', '¿Qué significa la sigla ONU?', ['Organización de Naciones Unidas', 'Orden Nacional Unificada', 'Oficina de Normas Universales', 'Organismo Naval Unido'], 0, 'Fundada en 1945 tras la Segunda Guerra Mundial.'),
  q('cultura', '¿Cuál es el libro más vendido de la historia después de la Biblia?', ['El Principito', 'Don Quijote de la Mancha', 'Harry Potter', 'El Señor de los Anillos'], 1, 'Se estiman más de 500 millones de copias del Quijote.'),
  q('cultura', '¿Qué autor creó a Sherlock Holmes?', ['Agatha Christie', 'Edgar Allan Poe', 'Arthur Conan Doyle', 'Charles Dickens'], 2, 'Apareció por primera vez en "Estudio en escarlata" (1887).'),
  q('cultura', '¿Cuántas cuerdas tiene una guitarra clásica?', ['Cuatro', 'Cinco', 'Seis', 'Siete'], 2, 'Afinadas normalmente en mi, la, re, sol, si, mi.'),
  q('cultura', '¿En qué ciudad está el museo del Louvre?', ['Roma', 'Madrid', 'Londres', 'París'], 3, 'Es el museo más visitado del mundo.'),
  q('cultura', '¿Qué figura del ajedrez solo se mueve en diagonal?', ['Torre', 'Alfil', 'Caballo', 'Rey'], 1, 'El alfil recorre cualquier número de casillas en diagonal.'),

  // Ciencia
  q('ciencia', '¿Cuál es el símbolo químico del oro?', ['Or', 'Go', 'Au', 'Ag'], 2, 'Viene del latín aurum.'),
  q('ciencia', '¿Qué planeta es el más grande del sistema solar?', ['Saturno', 'Júpiter', 'Neptuno', 'Urano'], 1, 'Su masa es más del doble que la del resto de planetas juntos.'),
  q('ciencia', '¿Cuántos huesos tiene el cuerpo humano adulto?', ['186', '206', '226', '256'], 1, 'Los bebés nacen con unos 270 que se fusionan al crecer.'),
  q('ciencia', '¿Qué gas respiramos principalmente del aire?', ['Oxígeno', 'Dióxido de carbono', 'Nitrógeno', 'Hidrógeno'], 2, 'El aire es ~78 % nitrógeno y ~21 % oxígeno.'),
  q('ciencia', '¿A qué velocidad aproximada viaja la luz en el vacío?', ['300 000 km/s', '150 000 km/s', '30 000 km/s', '3 000 000 km/s'], 0, 'Exactamente 299 792 458 m/s.'),
  q('ciencia', '¿Qué órgano produce la insulina?', ['Hígado', 'Riñón', 'Páncreas', 'Bazo'], 2, 'La producen las células beta de los islotes de Langerhans.'),
  q('ciencia', '¿Cuál es el metal líquido a temperatura ambiente?', ['Plomo', 'Mercurio', 'Estaño', 'Litio'], 1, 'Funde a -38,8 °C.'),
  q('ciencia', '¿Qué científico propuso la teoría de la relatividad?', ['Isaac Newton', 'Niels Bohr', 'Albert Einstein', 'Galileo Galilei'], 2, 'La especial en 1905 y la general en 1915.'),
  q('ciencia', '¿Cuál es la unidad de medida de la fuerza?', ['Julio', 'Vatio', 'Pascal', 'Newton'], 3, 'Un newton acelera 1 kg a 1 m/s².'),
  q('ciencia', '¿Qué molécula lleva la información genética?', ['ARN mensajero', 'ADN', 'Proteína', 'Glucosa'], 1, 'El ADN tiene estructura de doble hélice.'),
  q('ciencia', '¿Cuántos planetas tiene el sistema solar?', ['Siete', 'Ocho', 'Nueve', 'Diez'], 1, 'Plutón dejó de contarse como planeta en 2006.'),
  q('ciencia', '¿Qué parte de la célula produce energía?', ['Núcleo', 'Ribosoma', 'Mitocondria', 'Membrana'], 2, 'Por eso se le llama la central energética de la célula.'),
  q('ciencia', '¿Cuál es el hueso más largo del cuerpo humano?', ['Tibia', 'Húmero', 'Fémur', 'Peroné'], 2, 'Mide alrededor de una cuarta parte de la estatura.'),

  // Geografía
  q('geografia', '¿Cuál es el río más largo del mundo?', ['Nilo', 'Amazonas', 'Yangtsé', 'Misisipi'], 1, 'Casi 7 000 km; el Nilo le disputa el título según la medición.'),
  q('geografia', '¿Cuál es la capital de Australia?', ['Sídney', 'Melbourne', 'Canberra', 'Perth'], 2, 'Se eligió como compromiso entre Sídney y Melbourne.'),
  q('geografia', '¿Qué país tiene más habitantes?', ['China', 'India', 'Estados Unidos', 'Indonesia'], 1, 'India superó a China en 2023.'),
  q('geografia', '¿En qué continente está Egipto?', ['Asia', 'Europa', 'África', 'Oceanía'], 2, 'Aunque la península del Sinaí está en Asia.'),
  q('geografia', '¿Cuál es el desierto más grande del mundo (no polar)?', ['Gobi', 'Kalahari', 'Sahara', 'Atacama'], 2, 'Ocupa unos 9 millones de km².'),
  q('geografia', '¿Cuál es la montaña más alta del mundo?', ['K2', 'Everest', 'Kangchenjunga', 'Aconcagua'], 1, '8 849 m sobre el nivel del mar.'),
  q('geografia', '¿Qué país tiene forma de bota?', ['Grecia', 'Portugal', 'Italia', 'Croacia'], 2, 'La "punta" es Calabria y el "tacón" Apulia.'),
  q('geografia', '¿Cuál es el océano más grande?', ['Atlántico', 'Índico', 'Ártico', 'Pacífico'], 3, 'Cubre cerca de un tercio de la superficie terrestre.'),
  q('geografia', '¿Cuál es la capital de Canadá?', ['Toronto', 'Ottawa', 'Vancouver', 'Montreal'], 1, 'Toronto es la ciudad más grande, pero no la capital.'),
  q('geografia', '¿Qué país es el más grande del mundo en superficie?', ['Canadá', 'China', 'Rusia', 'Estados Unidos'], 2, 'Más de 17 millones de km².'),
  q('geografia', '¿Qué estrecho separa Europa de África?', ['Bósforo', 'Gibraltar', 'Bering', 'Magallanes'], 1, 'Apenas 14 km en su punto más angosto.'),
  q('geografia', '¿Cuál es el país más pequeño del mundo?', ['Mónaco', 'San Marino', 'Vaticano', 'Liechtenstein'], 2, 'Tiene menos de medio kilómetro cuadrado.'),
  q('geografia', '¿En qué país está el Machu Picchu?', ['Bolivia', 'Perú', 'Ecuador', 'Colombia'], 1, 'En la región de Cusco, a 2 430 m de altitud.'),

  // Deportes
  q('deportes', '¿Cada cuántos años se celebra el Mundial de fútbol?', ['Dos', 'Tres', 'Cuatro', 'Cinco'], 2, 'Igual que los Juegos Olímpicos.'),
  q('deportes', '¿Qué país ha ganado más Mundiales de fútbol?', ['Alemania', 'Argentina', 'Italia', 'Brasil'], 3, 'Cinco títulos: 1958, 1962, 1970, 1994 y 2002.'),
  q('deportes', '¿Cuántos jugadores tiene un equipo de baloncesto en cancha?', ['Cuatro', 'Cinco', 'Seis', 'Siete'], 1, 'Cinco por equipo, con sustituciones ilimitadas.'),
  q('deportes', '¿En qué deporte se usa el término "home run"?', ['Cricket', 'Béisbol', 'Golf', 'Rugby'], 1, 'El bateador recorre todas las bases de una vez.'),
  q('deportes', '¿Cuántos sets se necesitan para ganar un Grand Slam masculino de tenis?', ['Dos', 'Tres', 'Cuatro', 'Cinco'], 1, 'Se juega al mejor de cinco sets.'),
  q('deportes', '¿Qué país organizó los Juegos Olímpicos de 2016?', ['China', 'Reino Unido', 'Brasil', 'Japón'], 2, 'Río de Janeiro fue la primera sede sudamericana.'),
  q('deportes', '¿Cuánto dura un partido de fútbol reglamentario?', ['80 minutos', '90 minutos', '100 minutos', '120 minutos'], 1, 'Dos tiempos de 45 minutos.'),
  q('deportes', '¿Cuál es la distancia de un maratón?', ['21,1 km', '30 km', '42,195 km', '50 km'], 2, 'Fijada oficialmente en 1921.'),
  q('deportes', '¿Qué piloto tiene más títulos de Fórmula 1 (empatado)?', ['Ayrton Senna', 'Michael Schumacher', 'Sebastian Vettel', 'Fernando Alonso'], 1, 'Siete títulos, igualado por Lewis Hamilton.'),
  q('deportes', '¿En qué deporte destacó Michael Jordan?', ['Béisbol', 'Fútbol americano', 'Baloncesto', 'Golf'], 2, 'Seis anillos de la NBA con los Chicago Bulls.'),
  q('deportes', '¿Cuántos puntos vale un touchdown en fútbol americano?', ['Tres', 'Seis', 'Siete', 'Ocho'], 1, 'Seis, más el punto extra o conversión de dos.'),
  q('deportes', '¿Qué país inventó el judo?', ['China', 'Corea', 'Japón', 'Tailandia'], 2, 'Lo creó Jigoro Kano en 1882.'),
  q('deportes', '¿Cuántos hoyos tiene un campo de golf estándar?', ['Nueve', 'Doce', 'Dieciocho', 'Veinticuatro'], 2, 'Los campos de nueve hoyos se juegan dos veces.'),

  // Cine
  q('cine', '¿Qué película ganó el Óscar a mejor película en 2020 siendo surcoreana?', ['Oldboy', 'Parásitos', 'Burning', 'Memories of Murder'], 1, 'Primera película de habla no inglesa en ganar ese premio.'),
  q('cine', '¿Quién dirigió "Titanic" y "Avatar"?', ['Steven Spielberg', 'Ridley Scott', 'James Cameron', 'Peter Jackson'], 2, 'Ambas fueron la película más taquillera de la historia en su momento.'),
  q('cine', '¿Cómo se llama el mago protagonista de la saga de J. K. Rowling?', ['Frodo', 'Harry Potter', 'Percy Jackson', 'Gandalf'], 1, 'Ocho películas entre 2001 y 2011.'),
  q('cine', '¿Qué actor interpreta a Iron Man en Marvel?', ['Chris Evans', 'Robert Downey Jr.', 'Chris Hemsworth', 'Mark Ruffalo'], 1, 'Desde "Iron Man" (2008) hasta "Endgame" (2019).'),
  q('cine', '¿En qué película aparece la frase "Que la fuerza te acompañe"?', ['Star Trek', 'Dune', 'Star Wars', 'Blade Runner'], 2, 'La saga comenzó en 1977.'),
  q('cine', '¿Qué estudio creó "Toy Story"?', ['DreamWorks', 'Pixar', 'Illumination', 'Studio Ghibli'], 1, 'Fue el primer largometraje animado por computadora (1995).'),
  q('cine', '¿Quién dirigió "El laberinto del fauno"?', ['Alfonso Cuarón', 'Alejandro G. Iñárritu', 'Guillermo del Toro', 'Pedro Almodóvar'], 2, 'Ganó tres Óscar en 2007.'),
  q('cine', '¿Cómo se llama el tiburón protagonista de la película de Spielberg de 1975?', ['Bruce', 'Jaws', 'Moby', 'Nemo'], 1, 'En español se tituló "Tiburón".'),
  q('cine', '¿Qué director mexicano ganó el Óscar por "Roma"?', ['Guillermo del Toro', 'Alfonso Cuarón', 'Alejandro G. Iñárritu', 'Carlos Reygadas'], 1, 'Mejor director en 2019.'),
  q('cine', '¿Qué película animada tiene a Simba como protagonista?', ['Tarzán', 'El Rey León', 'Bambi', 'Madagascar'], 1, 'Estrenada por Disney en 1994.'),
  q('cine', '¿Quién interpretó a Jack Sparrow?', ['Orlando Bloom', 'Johnny Depp', 'Brad Pitt', 'Hugh Jackman'], 1, 'En "Piratas del Caribe" desde 2003.'),
  q('cine', '¿En qué ciudad ficticia vive Batman?', ['Metrópolis', 'Star City', 'Gotham', 'Central City'], 2, 'Metrópolis es la ciudad de Superman.'),
  q('cine', '¿Qué película tiene la frase "Hasta el infinito y más allá"?', ['Wall-E', 'Toy Story', 'Monsters Inc.', 'Buscando a Nemo'], 1, 'La dice Buzz Lightyear.'),

  // Historia
  q('historia', '¿En qué año llegó Cristóbal Colón a América?', ['1482', '1492', '1502', '1512'], 1, 'El 12 de octubre de 1492.'),
  q('historia', '¿Qué muro cayó en 1989?', ['Muro de Adriano', 'Gran Muralla', 'Muro de Berlín', 'Muro de las Lamentaciones'], 2, 'Marcó el fin simbólico de la Guerra Fría.'),
  q('historia', '¿Quién fue el primer ser humano en pisar la Luna?', ['Yuri Gagarin', 'Buzz Aldrin', 'Neil Armstrong', 'John Glenn'], 2, 'El 20 de julio de 1969 con el Apolo 11.'),
  q('historia', '¿En qué año terminó la Segunda Guerra Mundial?', ['1943', '1944', '1945', '1946'], 2, 'Alemania se rindió en mayo y Japón en septiembre.'),
  q('historia', '¿Qué civilización construyó las pirámides de Giza?', ['Mesopotámica', 'Egipcia', 'Griega', 'Persa'], 1, 'La Gran Pirámide se levantó hacia 2560 a. C.'),
  q('historia', '¿Quién fue el emperador francés derrotado en Waterloo?', ['Luis XIV', 'Carlomagno', 'Napoleón Bonaparte', 'Robespierre'], 2, 'La batalla fue en 1815.'),
  q('historia', '¿Qué imperio tenía su capital en Constantinopla?', ['Romano de Occidente', 'Bizantino', 'Persa', 'Mongol'], 1, 'Cayó ante los otomanos en 1453.'),
  q('historia', '¿En qué año comenzó la Primera Guerra Mundial?', ['1912', '1914', '1916', '1918'], 1, 'Tras el asesinato del archiduque Francisco Fernando.'),
  q('historia', '¿Quién pintó la Capilla Sixtina?', ['Leonardo da Vinci', 'Rafael', 'Miguel Ángel', 'Donatello'], 2, 'Entre 1508 y 1512.'),
  q('historia', '¿Qué documento se firmó en 1215 limitando el poder del rey inglés?', ['Carta Magna', 'Bill of Rights', 'Acta de Unión', 'Declaración de Derechos'], 0, 'Base del derecho constitucional moderno.'),
  q('historia', '¿Qué país fue el primero en dar el voto a las mujeres a nivel nacional?', ['Estados Unidos', 'Reino Unido', 'Nueva Zelanda', 'Francia'], 2, 'En 1893.'),
  q('historia', '¿Quién fue el líder de la independencia de la India?', ['Nehru', 'Gandhi', 'Jinnah', 'Tagore'], 1, 'Lideró la resistencia no violenta hasta 1947.'),
  q('historia', '¿Qué ciudad fue sepultada por el Vesubio en el año 79?', ['Roma', 'Nápoles', 'Pompeya', 'Atenas'], 2, 'Junto con Herculano.'),

  // México
  q('mexico', '¿En qué año inició la Independencia de México?', ['1800', '1810', '1821', '1824'], 1, 'Con el Grito de Dolores, el 16 de septiembre de 1810.'),
  q('mexico', '¿Cuál es el estado más grande de México?', ['Sonora', 'Coahuila', 'Chihuahua', 'Durango'], 2, 'Más de 247 000 km².'),
  q('mexico', '¿Qué civilización fundó Tenochtitlan?', ['Maya', 'Olmeca', 'Azteca (mexica)', 'Tolteca'], 2, 'En 1325 sobre un islote del lago de Texcoco.'),
  q('mexico', '¿Cuántos estados tiene México?', ['30', '31', '32', '33'], 2, '31 estados más la Ciudad de México.'),
  q('mexico', '¿Qué pintora mexicana es famosa por sus autorretratos?', ['Remedios Varo', 'Frida Kahlo', 'Leonora Carrington', 'María Izquierdo'], 1, 'Nació en Coyoacán en 1907.'),
  q('mexico', '¿Cuál es la moneda de México?', ['Peso', 'Real', 'Sol', 'Bolívar'], 0, 'Código ISO: MXN.'),
  q('mexico', '¿Qué volcán se encuentra cerca de Puebla y la CDMX?', ['Colima', 'Popocatépetl', 'Paricutín', 'Pico de Orizaba'], 1, 'Su nombre significa "montaña que humea".'),
  q('mexico', '¿Qué fecha se celebra el Día de Muertos?', ['31 de octubre', '1 y 2 de noviembre', '12 de diciembre', '5 de mayo'], 1, 'Patrimonio Cultural Inmaterial de la Humanidad desde 2008.'),
  q('mexico', '¿Cuál es la montaña más alta de México?', ['Popocatépetl', 'Iztaccíhuatl', 'Pico de Orizaba', 'Nevado de Toluca'], 2, 'También llamado Citlaltépetl, 5 636 m.'),
  q('mexico', '¿Qué zona arqueológica tiene la pirámide de Kukulkán?', ['Teotihuacan', 'Chichén Itzá', 'Monte Albán', 'Palenque'], 1, 'Una de las nuevas siete maravillas del mundo.'),
  q('mexico', '¿Quién fue el "Padre de la Patria" en México?', ['Benito Juárez', 'Miguel Hidalgo', 'José María Morelos', 'Emiliano Zapata'], 1, 'Dio el Grito de Dolores en 1810.'),
  q('mexico', '¿Qué bebida se obtiene del agave azul en Jalisco?', ['Mezcal', 'Pulque', 'Tequila', 'Sotol'], 2, 'Tiene denominación de origen.'),
  q('mexico', '¿Qué equipo de fútbol mexicano es conocido como "Las Chivas"?', ['América', 'Cruz Azul', 'Guadalajara', 'Pumas'], 2, 'Solo alinea jugadores mexicanos.'),

  // Latinoamérica
  q('latinoamerica', '¿Cuál es el país más grande de Sudamérica?', ['Argentina', 'Brasil', 'Colombia', 'Perú'], 1, 'Ocupa casi la mitad del continente.'),
  q('latinoamerica', '¿Qué país tiene a Buenos Aires como capital?', ['Uruguay', 'Chile', 'Argentina', 'Paraguay'], 2, 'Montevideo es la capital de Uruguay.'),
  q('latinoamerica', '¿Cuál es el lago navegable más alto del mundo?', ['Titicaca', 'Maracaibo', 'Nicaragua', 'Atitlán'], 0, 'Entre Perú y Bolivia, a 3 812 m.'),
  q('latinoamerica', '¿En qué país nació el libertador Simón Bolívar?', ['Colombia', 'Venezuela', 'Ecuador', 'Perú'], 1, 'En Caracas, en 1783.'),
  q('latinoamerica', '¿Qué país sudamericano tiene como idioma oficial el portugués?', ['Brasil', 'Surinam', 'Guyana', 'Uruguay'], 0, 'Herencia de la colonización portuguesa.'),
  q('latinoamerica', '¿Cuál es la capital de Chile?', ['Valparaíso', 'Santiago', 'Concepción', 'Antofagasta'], 1, 'Valparaíso alberga el Congreso.'),
  q('latinoamerica', '¿Qué cantante colombiana canta "Hips Don\'t Lie"?', ['Karol G', 'Shakira', 'Natalia Lafourcade', 'Rosalía'], 1, 'Número uno mundial en 2006.'),
  q('latinoamerica', '¿Qué país tiene la cordillera de los Andes en toda su longitud?', ['Brasil', 'Chile', 'Paraguay', 'Uruguay'], 1, 'Los Andes recorren Chile de norte a sur.'),
  q('latinoamerica', '¿Qué baile es originario de Argentina y Uruguay?', ['Salsa', 'Cumbia', 'Tango', 'Bachata'], 2, 'Patrimonio de la Humanidad desde 2009.'),
  q('latinoamerica', '¿Cuál es la capital de Perú?', ['Cusco', 'Arequipa', 'Lima', 'Trujillo'], 2, 'Fundada por Pizarro en 1535.'),
  q('latinoamerica', '¿Qué país centroamericano tiene un canal que une dos océanos?', ['Costa Rica', 'Nicaragua', 'Panamá', 'Honduras'], 2, 'Inaugurado en 1914.'),
  q('latinoamerica', '¿De qué país es el escritor Jorge Luis Borges?', ['Chile', 'Uruguay', 'Argentina', 'México'], 2, 'Nació en Buenos Aires en 1899.'),
  q('latinoamerica', '¿Cuál es la cascada más alta del mundo, ubicada en Venezuela?', ['Iguazú', 'Salto Ángel', 'Kaieteur', 'Gocta'], 1, '979 m de caída.'),
];
