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
    const conceptIndex = data.concepts.findIndex(c => c.id === id);
    if (conceptIndex === -1) throw new Error('概念不存在');

    const concept = data.concepts[conceptIndex];
    concept.deletedAt = new Date().toISOString();

    // 移动到已删除数组
    data.deletedConcepts = data.deletedConcepts || [];
    data.deletedConcepts.push(concept);

    // 从活跃列表移除
    data.concepts.splice(conceptIndex, 1);

    await this.writeData(data);
  }

  // 获取已删除概念列表
  async getDeletedConcepts() {
    const data = await this.readData();
    return data.deletedConcepts || [];
  }

  // 恢复概念
  async restoreConcept(id) {
    const data = await this.readData();
    const deletedIndex = data.deletedConcepts.findIndex(c => c.id === id);
    if (deletedIndex === -1) throw new Error('已删除概念不存在');

    const concept = data.deletedConcepts[deletedIndex];
    delete concept.deletedAt;

    data.concepts.push(concept);
    data.deletedConcepts.splice(deletedIndex, 1);

    await this.writeData(data);
  }

  // 永久删除概念
  async permanentlyDeleteConcept(id) {
    const data = await this.readData();
    data.deletedConcepts = (data.deletedConcepts || []).filter(c => c.id !== id);
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
