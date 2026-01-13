const fs = require('fs').promises;
const path = require('path');

const DATA_FILE = path.join(__dirname, '../data/concepts.json');

class DataService {
  async readData() {
    try {
      const content = await fs.readFile(DATA_FILE, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      if (error.code === 'ENOENT') {
        await this.writeData({ concepts: [] });
        return { concepts: [] };
      }
      throw error;
    }
  }

  async writeData(data) {
    await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
  }

  async getAllConcepts() {
    const data = await this.readData();
    return data.concepts;
  }

  async getConceptById(id) {
    const concepts = await this.getAllConcepts();
    return concepts.find(c => c.id === id);
  }

  async createConcept(name, stocks) {
    const data = await this.readData();
    const concept = {
      id: `concept_${Date.now()}`,
      name,
      createdAt: new Date().toISOString(),
      stocks
    };
    data.concepts.push(concept);
    await this.writeData(data);
    return concept;
  }

  async deleteConcept(id) {
    const data = await this.readData();
    data.concepts = data.concepts.filter(c => c.id !== id);
    await this.writeData(data);
  }

  async updateConceptStocks(id, stocks) {
    const data = await this.readData();
    const concept = data.concepts.find(c => c.id === id);
    if (concept) {
      concept.stocks = stocks;
      concept.updatedAt = new Date().toISOString();
      await this.writeData(data);
    }
    return concept;
  }
}

module.exports = new DataService();
