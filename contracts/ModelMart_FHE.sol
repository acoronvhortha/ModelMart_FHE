pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract ModelMart_FHE is ZamaEthereumConfig {
    struct Model {
        string name;
        euint32 encryptedModel;
        uint256 price;
        string description;
        address owner;
        uint256 timestamp;
        bool isActive;
    }

    struct InferenceRequest {
        string modelId;
        euint32 encryptedInput;
        address requester;
        uint256 timestamp;
        bool isProcessed;
        euint32 encryptedResult;
    }

    mapping(string => Model) public models;
    mapping(string => InferenceRequest) public inferenceRequests;
    mapping(address => uint256) public balances;

    string[] public modelIds;
    string[] public requestIds;

    event ModelRegistered(string indexed modelId, address indexed owner);
    event InferenceRequested(string indexed requestId, string indexed modelId);
    event InferenceCompleted(string indexed requestId, euint32 encryptedResult);
    event ModelPurchased(string indexed modelId, address indexed buyer);

    constructor() ZamaEthereumConfig() {
    }

    function registerModel(
        string calldata modelId,
        string calldata name,
        externalEuint32 encryptedModel,
        bytes calldata modelProof,
        uint256 price,
        string calldata description
    ) external {
        require(bytes(models[modelId].name).length == 0, "Model already exists");
        require(FHE.isInitialized(FHE.fromExternal(encryptedModel, modelProof)), "Invalid encrypted model");

        models[modelId] = Model({
            name: name,
            encryptedModel: FHE.fromExternal(encryptedModel, modelProof),
            price: price,
            description: description,
            owner: msg.sender,
            timestamp: block.timestamp,
            isActive: true
        });

        FHE.allowThis(models[modelId].encryptedModel);
        FHE.makePubliclyDecryptable(models[modelId].encryptedModel);

        modelIds.push(modelId);
        emit ModelRegistered(modelId, msg.sender);
    }

    function requestInference(
        string calldata modelId,
        string calldata requestId,
        externalEuint32 encryptedInput,
        bytes calldata inputProof
    ) external payable {
        require(bytes(models[modelId].name).length > 0, "Model does not exist");
        require(models[modelId].isActive, "Model is not active");
        require(bytes(inferenceRequests[requestId].modelId).length == 0, "Request ID already exists");
        require(msg.value >= models[modelId].price, "Insufficient payment");

        inferenceRequests[requestId] = InferenceRequest({
            modelId: modelId,
            encryptedInput: FHE.fromExternal(encryptedInput, inputProof),
            requester: msg.sender,
            timestamp: block.timestamp,
            isProcessed: false,
            encryptedResult: euint32(0)
        });

        FHE.allowThis(inferenceRequests[requestId].encryptedInput);
        FHE.makePubliclyDecryptable(inferenceRequests[requestId].encryptedInput);

        balances[models[modelId].owner] += models[modelId].price;

        requestIds.push(requestId);
        emit InferenceRequested(requestId, modelId);
    }

    function processInference(
        string calldata requestId,
        bytes calldata computationProof
    ) external {
        require(bytes(inferenceRequests[requestId].modelId).length > 0, "Request does not exist");
        require(!inferenceRequests[requestId].isProcessed, "Request already processed");

        Model storage model = models[inferenceRequests[requestId].modelId];
        euint32 memory result = FHE.add(
            model.encryptedModel,
            inferenceRequests[requestId].encryptedInput,
            computationProof
        );

        inferenceRequests[requestId].encryptedResult = result;
        inferenceRequests[requestId].isProcessed = true;

        FHE.allowThis(inferenceRequests[requestId].encryptedResult);
        FHE.makePubliclyDecryptable(inferenceRequests[requestId].encryptedResult);

        emit InferenceCompleted(requestId, result);
    }

    function purchaseModel(string calldata modelId) external payable {
        require(bytes(models[modelId].name).length > 0, "Model does not exist");
        require(models[modelId].isActive, "Model is not active");
        require(msg.value >= models[modelId].price, "Insufficient payment");

        balances[models[modelId].owner] += models[modelId].price;
        emit ModelPurchased(modelId, msg.sender);
    }

    function withdrawBalance() external {
        uint256 amount = balances[msg.sender];
        require(amount > 0, "No balance to withdraw");

        balances[msg.sender] = 0;
        payable(msg.sender).transfer(amount);
    }

    function getEncryptedModel(string calldata modelId) external view returns (euint32) {
        require(bytes(models[modelId].name).length > 0, "Model does not exist");
        return models[modelId].encryptedModel;
    }

    function getInferenceResult(string calldata requestId) external view returns (euint32) {
        require(bytes(inferenceRequests[requestId].modelId).length > 0, "Request does not exist");
        require(inferenceRequests[requestId].isProcessed, "Request not processed");
        return inferenceRequests[requestId].encryptedResult;
    }

    function getAllModelIds() external view returns (string[] memory) {
        return modelIds;
    }

    function getAllRequestIds() external view returns (string[] memory) {
        return requestIds;
    }

    function getModelDetails(string calldata modelId) external view returns (
        string memory name,
        uint256 price,
        string memory description,
        address owner,
        uint256 timestamp,
        bool isActive
    ) {
        require(bytes(models[modelId].name).length > 0, "Model does not exist");
        Model storage model = models[modelId];
        return (
            model.name,
            model.price,
            model.description,
            model.owner,
            model.timestamp,
            model.isActive
        );
    }

    function getInferenceRequestDetails(string calldata requestId) external view returns (
        string memory modelId,
        address requester,
        uint256 timestamp,
        bool isProcessed
    ) {
        require(bytes(inferenceRequests[requestId].modelId).length > 0, "Request does not exist");
        InferenceRequest storage request = inferenceRequests[requestId];
        return (
            request.modelId,
            request.requester,
            request.timestamp,
            request.isProcessed
        );
    }

    function isAvailable() public pure returns (bool) {
        return true;
    }
}


