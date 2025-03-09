// Web3 integration for crypto rewards
export class Web3Manager {
    constructor() {
        this.web3 = null;
        this.contract = null;
        this.account = null;
        this.initialized = false;
        
        // Contract ABI - replace with your actual contract ABI
        this.contractABI = [
            {
                "inputs": [{"name": "winner", "type": "address"}],
                "name": "distributeReward",
                "outputs": [],
                "stateMutability": "payable",
                "type": "function"
            }
        ];
        
        // Contract address - replace with your actual contract address
        this.contractAddress = '0xYOUR_CONTRACT_ADDRESS';
    }

    async init() {
        if (typeof window.ethereum === 'undefined') {
            console.log('MetaMask not installed');
            return false;
        }

        try {
            // Request account access
            const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
            this.account = accounts[0];
            
            // Create Web3 instance
            this.web3 = new Web3(window.ethereum);
            
            // Create contract instance
            this.contract = new this.web3.eth.Contract(this.contractABI, this.contractAddress);
            
            this.initialized = true;
            return true;
        } catch (error) {
            console.error('Error initializing Web3:', error);
            return false;
        }
    }

    async distributeReward(winnerAddress) {
        if (!this.initialized) {
            console.error('Web3 not initialized');
            return;
        }

        try {
            await this.contract.methods.distributeReward(winnerAddress)
                .send({ from: this.account });
            console.log('Reward distributed to:', winnerAddress);
        } catch (error) {
            console.error('Error distributing reward:', error);
        }
    }

    async getBalance() {
        if (!this.initialized) return '0';
        try {
            const balance = await this.web3.eth.getBalance(this.account);
            return this.web3.utils.fromWei(balance, 'ether');
        } catch (error) {
            console.error('Error getting balance:', error);
            return '0';
        }
    }
}
